"""
Tally Prime XML Generation and Integration Service
Matches frontend tallyService.ts 1:1
"""
import re
import uuid
from typing import Dict, Set, List, Any, Optional
from datetime import datetime
import requests


# --- HELPER FUNCTIONS ---

def esc(text: Any) -> str:
    """XML escape string"""
    if not text:
        return ''
    s = str(text)
    return (s
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", ' '))


def clean_name(text: Any) -> str:
    """Clean name for Tally - remove special chars, limit to 50 chars"""
    if not text:
        return 'Unknown Item'
    s = str(text)
    cleaned = re.sub(r'[^a-zA-Z0-9\s\-\.\(\)%]', '', s)
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = cleaned.strip()[:50]
    return cleaned


def round_val(num: Any) -> float:
    """Strict rounding to 2 decimals"""
    f = float(num) if num else 0.0
    return round(f + 1e-10, 2)


def format_rate(num: Any) -> str:
    """Format rate as integer or 1 decimal"""
    f = float(num) if num else 0.0
    if f == int(f):
        return str(int(f))
    return f"{f:.1f}".rstrip('0').rstrip('.')


def format_date_for_xml(date_str: Any) -> str:
    """Convert date to YYYYMMDD format for Tally XML"""
    s = str(date_str) if date_str else ''
    if not s:
        today = datetime.now()
        return today.strftime('%Y%m%d')
    
    # Normalize separators
    d = s.replace('.', '-').replace('/', '-').replace(' ', '-')
    
    # YYYY-MM-DD -> YYYYMMDD
    if re.match(r'^\d{4}-\d{2}-\d{2}$', d):
        return d.replace('-', '')
    
    # DD-MM-YYYY -> YYYYMMDD
    match = re.match(r'^(\d{1,2})-(\d{1,2})-(\d{4})$', d)
    if match:
        day, month, year = match.groups()
        return f"{year}{month.zfill(2)}{day.zfill(2)}"
    
    # Fallback to today
    today = datetime.now()
    return today.strftime('%Y%m%d')


STATE_MAP = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
    "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
    "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
    "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
    "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra", "29": "Karnataka",
    "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
    "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
    "37": "Andhra Pradesh", "38": "Ladakh"
}


def get_state_name(gstin: str) -> str:
    """Get state name from GSTIN (first 2 chars)"""
    if not gstin or len(gstin) < 2:
        return ''
    code = gstin[:2]
    return STATE_MAP.get(code, '')


# --- INVOICE XML GENERATION ---

def generate_tally_xml(invoice: Any, line_items: Any = None, existing_ledgers: Optional[Set[str]] = None) -> str:
    """
    Generate Tally XML for invoice matching frontend generateTallyXml 1:1
    Accepts both SQLAlchemy models and plain objects (for testing)
    """
    if existing_ledgers is None:
        existing_ledgers = set()
    
    if line_items is None:
        line_items = []
    
    # Convert SQLAlchemy column values to native Python types immediately
    invoice_date = str(invoice.invoice_date or '')
    invoice_number = str(invoice.invoice_number or '')
    buyer_name_str = str(getattr(invoice, 'buyer_name', None) or 'Cash Buyer')
    supplier_name = str(getattr(invoice, 'supplier_name', None) or 'Cash Party')
    gstin = str(getattr(invoice, 'gstin', None) or '')
    buyer_gstin = str(getattr(invoice, 'buyer_gstin', None) or '')
    
    # Basic info
    is_sales = False  # Default to Purchase for backend
    date_xml = format_date_for_xml(invoice_date)
    
    # Generate IDs
    guid = str(uuid.uuid4())
    remote_id = str(uuid.uuid4())
    vch_key = f"{uuid.uuid4()}:00000008"
    
    sv_company = "##SVCurrentCompany"
    
    # Party name and GSTIN
    raw_party_name = (buyer_name_str if is_sales else supplier_name) or "Cash Party"
    party_name = clean_name(raw_party_name)
    party_group = "Sundry Debtors" if is_sales else "Sundry Creditors"
    ledger_parent_group = "Sales Accounts" if is_sales else "Purchase Accounts"
    
    supplier_gstin_clean = (gstin or '').strip().upper()
    buyer_gstin_clean = (buyer_gstin or '').strip().upper()
    party_gstin = buyer_gstin_clean if is_sales else supplier_gstin_clean
    party_state = get_state_name(party_gstin) or 'Maharashtra'
    
    # Inter-State vs Intra-State logic
    s_state = supplier_gstin_clean[:2] if supplier_gstin_clean else '27'
    b_state = buyer_gstin_clean[:2] if buyer_gstin_clean else '27'
    is_inter_state = (s_state and b_state and s_state != b_state)
    
    # Signage logic (matching frontend)
    party_deemed_pos = "Yes" if is_sales else "No"
    item_deemed_pos = "No" if is_sales else "Yes"
    item_sign = 1 if is_sales else -1
    
    tax_ledger_totals: Dict[str, float] = {}
    total_voucher_value = 0.0
    
    # --- MASTERS XML ---
    masters_xml = f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <UNIT NAME="Nos" ACTION="Create">
        <NAME>Nos</NAME>
        <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
      </UNIT>
    </TALLYMESSAGE>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <GROUP NAME="{ledger_parent_group}" ACTION="Create">
        <NAME.LIST><NAME>{ledger_parent_group}</NAME></NAME.LIST>
        <PARENT>Primary</PARENT>
      </GROUP>
    </TALLYMESSAGE>"""
    
    # Party Ledger
    if party_name not in existing_ledgers:
        party_gstin_xml = f"<PARTYGSTIN>{esc(party_gstin)}</PARTYGSTIN>" if party_gstin else ""
        party_state_xml = f"<STATENAME>{esc(party_state)}</STATENAME>" if party_state else ""
        masters_xml += f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="{esc(party_name)}" ACTION="Create">
        <NAME.LIST><NAME>{esc(party_name)}</NAME></NAME.LIST>
        <PARENT>{party_group}</PARENT>
        <ISBILLWISEON>Yes</ISBILLWISEON>
        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
        {party_gstin_xml}
        {party_state_xml}
      </LEDGER>
    </TALLYMESSAGE>"""
    
    # Stock Items and Rate Ledgers
    unique_rates = set()
    for item in line_items:
        item_gst_rate = float(getattr(item, 'gst_rate', None) or 18)
        item_desc = str(getattr(item, 'description', None) or '')
        rate = int(item_gst_rate) if item_gst_rate == int(item_gst_rate) else item_gst_rate
        unique_rates.add(rate)
        
        item_name = clean_name(item_desc) or f"Item @ {rate}%"
        masters_xml += f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="{esc(item_name)}" ACTION="Create">
        <NAME.LIST><NAME>{esc(item_name)}</NAME></NAME.LIST>
        <PARENT>Primary</PARENT>
        <BASEUNITS>Nos</BASEUNITS>
        <OPENINGBALANCE>0 Nos</OPENINGBALANCE>
        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
        <GSTRATE>{rate}</GSTRATE>
      </STOCKITEM>
    </TALLYMESSAGE>"""
    
    # Rate Ledgers and Tax Ledgers
    for rate in unique_rates:
        ledger_name = f"{'Sale' if is_sales else 'Purchase'} {format_rate(rate)}%"
        if ledger_name not in existing_ledgers:
            masters_xml += f"""
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="{esc(ledger_name)}" ACTION="Create">
            <NAME.LIST><NAME>{esc(ledger_name)}</NAME></NAME.LIST>
            <PARENT>{ledger_parent_group}</PARENT>
            <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
            <GSTRATE>{rate}</GSTRATE>
        </LEDGER>
        </TALLYMESSAGE>"""
        
        # Tax Ledgers (CGST/SGST or IGST)
        if is_inter_state:
            igst_name = f"{'Output' if is_sales else 'Input'} IGST {format_rate(rate)}%"
            if igst_name not in existing_ledgers:
                masters_xml += f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="{esc(igst_name)}" ACTION="Create">
            <NAME.LIST><NAME>{esc(igst_name)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>
            <GSTRATE>{rate}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>"""
        else:
            half = rate / 2
            cgst_name = f"{'Output' if is_sales else 'Input'} CGST {format_rate(half)}%"
            sgst_name = f"{'Output' if is_sales else 'Input'} SGST {format_rate(half)}%"
            
            if cgst_name not in existing_ledgers:
                masters_xml += f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="{esc(cgst_name)}" ACTION="Create">
            <NAME.LIST><NAME>{esc(cgst_name)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>
            <GSTRATE>{half}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>"""
            
            if sgst_name not in existing_ledgers:
                masters_xml += f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="{esc(sgst_name)}" ACTION="Create">
            <NAME.LIST><NAME>{esc(sgst_name)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>State Tax</GSTDUTYHEAD>
            <GSTRATE>{half}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>"""
    
    # --- INVENTORY XML ---
    inventory_xml = ""
    for item in line_items:
        item_gst_rate = float(getattr(item, 'gst_rate', None) or 18)
        item_qty = float(getattr(item, 'qty', None) or 1)
        item_rate_val = float(getattr(item, 'rate', None) or 0)
        item_desc = str(getattr(item, 'description', None) or '')
        
        rate = int(item_gst_rate) if item_gst_rate == int(item_gst_rate) else item_gst_rate
        qty = item_qty
        item_rate = item_rate_val
        
        amount = round_val(qty * item_rate)
        item_name = clean_name(item_desc) or f"Item @ {rate}%"
        ledger_name = f"{'Sale' if is_sales else 'Purchase'} {format_rate(rate)}%"
        
        total_voucher_value += amount
        line_tax = round_val(amount * (rate / 100))
        total_voucher_value += line_tax
        
        # TAX SPLIT LOGIC
        if is_inter_state:
            igst_name = f"{'Output' if is_sales else 'Input'} IGST {format_rate(rate)}%"
            tax_ledger_totals[igst_name] = tax_ledger_totals.get(igst_name, 0) + line_tax
        else:
            half = rate / 2
            cgst_name = f"{'Output' if is_sales else 'Input'} CGST {format_rate(half)}%"
            sgst_name = f"{'Output' if is_sales else 'Input'} SGST {format_rate(half)}%"
            half_tax = round_val(line_tax / 2)
            remainder = round_val(line_tax - half_tax)
            tax_ledger_totals[cgst_name] = tax_ledger_totals.get(cgst_name, 0) + half_tax
            tax_ledger_totals[sgst_name] = tax_ledger_totals.get(sgst_name, 0) + remainder
        
        amount_str = f"{amount * item_sign:.2f}"
        
        inventory_xml += f"""
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>{esc(item_name)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>{item_deemed_pos}</ISDEEMEDPOSITIVE>
          <ACTUALQTY>{qty} Nos</ACTUALQTY>
          <BILLEDQTY>{qty} Nos</BILLEDQTY>
          <RATE>{item_rate:.2f}/Nos</RATE>
          <AMOUNT>{amount_str}</AMOUNT>
          <ACCOUNTINGALLOCATIONS.LIST>
             <LEDGERNAME>{esc(ledger_name)}</LEDGERNAME>
             <ISDEEMEDPOSITIVE>{item_deemed_pos}</ISDEEMEDPOSITIVE>
             <AMOUNT>{amount_str}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>"""
    
    # --- TAX LEDGERS XML ---
    tax_ledgers_xml = ""
    for name, raw_amt in tax_ledger_totals.items():
        amt = round_val(raw_amt)
        if amt > 0:
            tax_amt_str = f"{amt * item_sign:.2f}"
            tax_ledgers_xml += f"""
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>{esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>{item_deemed_pos}</ISDEEMEDPOSITIVE>
          <AMOUNT>{tax_amt_str}</AMOUNT>
        </LEDGERENTRIES.LIST>"""
    
    # --- PARTY AMOUNT ---
    party_sign = -1 if is_sales else 1
    final_party_total = round_val(total_voucher_value)
    party_amount_str = f"{final_party_total * party_sign:.2f}"
    
    return f"""
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>

  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{sv_company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>{masters_xml}</REQUESTDATA>
    </IMPORTDATA>

    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{sv_company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>

      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER 
            REMOTEID="{remote_id}"
            VCHKEY="{vch_key}"
            VCHTYPE="Purchase"
            ACTION="Create"
            OBJVIEW="Invoice Voucher View">

            <OLDAUDITENTRYIDS.LIST TYPE="Number">
               <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>

            <DATE>{date_xml}</DATE>
            <EFFECTIVEDATE>{date_xml}</EFFECTIVEDATE>
            <REFERENCEDATE>{date_xml}</REFERENCEDATE>
            <VCHSTATUSDATE>{date_xml}</VCHSTATUSDATE>
            <GUID>{guid}</GUID>

            <STATENAME>{esc(party_state)}</STATENAME>
            <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
            <PARTYGSTIN>{esc(party_gstin)}</PARTYGSTIN>
            <PLACEOFSUPPLY>{esc(party_state)}</PLACEOFSUPPLY>

            <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>{esc(party_name)}</PARTYLEDGERNAME>
            <VOUCHERNUMBER>{esc(invoice_number)}</VOUCHERNUMBER>
            
            <REFERENCE>{esc(invoice_number)}</REFERENCE>
            <BASICBUYERNAME>{esc(buyer_name_str)}</BASICBUYERNAME>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>Invoice No: {esc(invoice_number)} | Date: {esc(invoice_date)} | Generated by AutoTally AI</NARRATION>

            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(party_name)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>{party_deemed_pos}</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>{party_amount_str}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>{esc(invoice_number)}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>{party_amount_str}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </LEDGERENTRIES.LIST>

            {inventory_xml}

            {tax_ledgers_xml}

          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""


def check_tally_connection() -> Dict[str, Any]:
    """Check if Tally is online"""
    try:
        response = requests.get("http://localhost:9000/health", timeout=5)
        if response.status_code == 200:
            return {"online": True, "info": "Tally Connected", "mode": "full"}
        return {"online": True, "info": "Port Open", "mode": "full"}
    except Exception as e:
        return {"online": False, "info": f"Offline: {str(e)}", "mode": "none"}


def fetch_existing_ledgers() -> Set[str]:
    """Fetch existing ledgers from Tally"""
    return set()


def fetch_open_companies() -> List[str]:
    """Fetch open companies from Tally"""
    return []


def push_to_tally(xml: str) -> Dict[str, Any]:
    """Push XML to Tally and parse response"""
    try:
        response = requests.post(
            "http://localhost:9000",
            data=xml,
            headers={'Content-Type': 'text/plain'},
            timeout=30
        )
        
        text = response.text
        
        if '<LINEERROR>' in text:
            match = re.search(r'<LINEERROR>(.*?)</LINEERROR>', text)
            error_msg = match.group(1) if match else "Unknown Tally Error"
            return {"success": False, "message": f"Tally Error: {error_msg}"}
        
        created_match = re.search(r'<CREATED>(\d+)</CREATED>', text)
        altered_match = re.search(r'<ALTERED>(\d+)</ALTERED>', text)
        errors_match = re.search(r'<ERRORS>(\d+)</ERRORS>', text)
        
        created = int(created_match.group(1)) if created_match else 0
        altered = int(altered_match.group(1)) if altered_match else 0
        errors = int(errors_match.group(1)) if errors_match else 0
        
        if errors > 0:
            return {"success": False, "message": f"Tally reported {errors} errors"}
        
        if created > 0 or altered > 0:
            return {"success": True, "message": f"Success: Created {created}, Altered {altered}"}
        
        return {"success": False, "message": "Tally ignored the request"}
    
    except Exception as e:
        return {"success": False, "message": f"Network Error: {str(e)}"}


def generate_bank_statement_xml(data: Any, existing_ledgers: Optional[Set[str]] = None) -> str:
    """Generate Tally XML for bank statement"""
    if existing_ledgers is None:
        existing_ledgers = set()
    return "<ENVELOPE></ENVELOPE>"


def tally_proxy_push(tally_url: str, xml_data: str) -> Dict[str, Any]:
    """Proxy Tally push"""
    return push_to_tally(xml_data)
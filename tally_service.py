# backend/tally_service.py
"""
Tally Prime XML Generation and Integration Service
"""
import re
import uuid
from typing import Dict, Set, List, Any, Optional
from datetime import datetime
import requests

def esc(text: Any) -> str:
    if not text:
        return ''
    s = str(text)
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", ' '))

def clean_name(text: Any) -> str:
    if not text:
        return 'Unknown Item'
    s = str(text)
    cleaned = re.sub(r'[^a-zA-Z0-9\s\-\.\(\)%]', '', s)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()[:50]
    return cleaned

def round_val(num: Any) -> float:
    f = float(num) if num else 0.0
    return round(f + 1e-10, 2)

def format_rate(num: Any) -> str:
    f = float(num) if num else 0.0
    if f == int(f):
        return str(int(f))
    return f"{f:.1f}".rstrip('0').rstrip('.')

def format_date_for_xml(date_str: Any) -> str:
    s = str(date_str) if date_str else ''
    if not s:
        today = datetime.now()
        return today.strftime('%Y%m%d')
    d = s.replace('.', '-').replace('/', '-').replace(' ', '-')
    if re.match(r'^\d{4}-\d{2}-\d{2}$', d):
        return d.replace('-', '')
    match = re.match(r'^(\d{1,2})-(\d{1,2})-(\d{4})$', d)
    if match:
        day, month, year = match.groups()
        return f"{year}{month.zfill(2)}{day.zfill(2)}"
    today = datetime.now()
    return today.strftime('%Y%m%d')

STATE_MAP = {
    "27": "Maharashtra", "29": "Karnataka", # truncated map; include full mapping in real project
    "07": "Delhi"
}
def get_state_name(gstin: str) -> str:
    if not gstin or len(gstin) < 2:
        return ''
    code = gstin[:2]
    return STATE_MAP.get(code, '')

def generate_tally_xml(invoice: Any, line_items: Any = None, existing_ledgers: Optional[Set[str]] = None) -> str:
    if existing_ledgers is None:
        existing_ledgers = set()
    if line_items is None:
        line_items = []

    invoice_date = str(getattr(invoice, 'invoice_date', '') or '')
    invoice_number = str(getattr(invoice, 'invoice_number', '') or '')
    buyer_name_str = str(getattr(invoice, 'buyer_name', None) or 'Cash Buyer')
    supplier_name = str(getattr(invoice, 'supplier_name', None) or 'Cash Party')
    gstin = str(getattr(invoice, 'gstin', None) or '')
    buyer_gstin = str(getattr(invoice, 'buyer_gstin', None) or '')

    is_sales = False
    date_xml = format_date_for_xml(invoice_date)
    guid = str(uuid.uuid4())
    remote_id = str(uuid.uuid4())
    vch_key = f"{uuid.uuid4()}:000000c8"
    sv_company = "##SVCurrentCompany"

    party_name = clean_name(supplier_name if not is_sales else buyer_name_str)
    party_group = "Sundry Creditors" if not is_sales else "Sundry Debtors"
    ledger_parent_group = "Purchase Accounts" if not is_sales else "Sales Accounts"

    supplier_gstin_clean = (gstin or '').strip().upper()
    buyer_gstin_clean = (buyer_gstin or '').strip().upper()
    party_gstin = supplier_gstin_clean if not is_sales else buyer_gstin_clean
    party_state = get_state_name(party_gstin) or 'Maharashtra'

    # Determine if inter-state (home state = 27 Maharashtra)
    is_valid_gstin = len(party_gstin) == 15
    is_inter_state = is_valid_gstin and party_gstin[:2] != "27"

    item_sign = -1 if not is_sales else 1

    masters_xml = f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <UNIT NAME="Nos" ACTION="Create">
        <NAME>Nos</NAME>
        <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
      </UNIT>
    </TALLYMESSAGE>
    """

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

    unique_rates = set()
    for item in line_items:
        item_gst_rate = float(getattr(item, 'gst_rate', None) or 18)
        item_desc = str(getattr(item, 'description', None) or '')
        rate = int(item_gst_rate) if item_gst_rate == int(item_gst_rate) else item_gst_rate
        unique_rates.add(rate)

    # Create Purchase Ledgers
    for rate in unique_rates:
        ledger_name = f"PURCHASE @{int(rate) if rate == int(rate) else rate}%"
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

    # Create Tax Ledgers
    for rate in unique_rates:
        if rate > 0:
            if is_inter_state:
                # IGST at full rate
                igst_name = f"Input IGST {format_rate(rate)}%"
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
                # CGST + SGST at half rates
                half_rate = rate / 2
                cgst_name = f"Input CGST@{format_rate(half_rate)}%"
                sgst_name = f"Input SGST@{format_rate(half_rate)}%"
                
                for tax_name, duty_head in [(cgst_name, "Central Tax"), (sgst_name, "State Tax")]:
                    if tax_name not in existing_ledgers:
                        masters_xml += f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="{esc(tax_name)}" ACTION="Create">
        <NAME.LIST><NAME>{esc(tax_name)}</NAME></NAME.LIST>
        <PARENT>Duties &amp; Taxes</PARENT>
        <TAXTYPE>GST</TAXTYPE>
        <GSTDUTYHEAD>{duty_head}</GSTDUTYHEAD>
        <GSTRATE>{half_rate}</GSTRATE>
    </LEDGER>
    </TALLYMESSAGE>"""

    # create vouchers
    inventory_xml = ""
    tax_ledger_totals = {}
    purchase_ledger_totals = {}
    total_voucher_value = 0.0
    
    for item in line_items:
        item_gst_rate = float(getattr(item, 'gst_rate', None) or 18)
        item_qty = float(getattr(item, 'qty', None) or 1)
        item_rate_val = float(getattr(item, 'rate', None) or 0)
        item_desc = str(getattr(item, 'description', None) or '')
        rate = item_gst_rate
        qty = item_qty
        item_rate = item_rate_val
        amount = round_val(qty * item_rate)
        item_name = clean_name(item_desc) or f"Item @ {rate}%"
        
        # Track purchase ledger totals by rate
        rate_str = f"{int(rate) if rate == int(rate) else rate}%"
        purchase_ledger_totals[rate_str] = purchase_ledger_totals.get(rate_str, 0) + amount
        
        total_voucher_value += amount
        line_tax = round_val(amount * (rate / 100))
        total_voucher_value += line_tax

        # Calculate tax ledger amounts
        if is_inter_state:
            igst_name = f"Input IGST {format_rate(rate)}%"
            tax_ledger_totals[igst_name] = tax_ledger_totals.get(igst_name, 0) + line_tax
        else:
            half = rate / 2
            cgst_name = f"Input CGST@{format_rate(half)}%"
            sgst_name = f"Input SGST@{format_rate(half)}%"
            half_tax = round_val(line_tax / 2)
            remainder = round_val(line_tax - half_tax)
            tax_ledger_totals[cgst_name] = tax_ledger_totals.get(cgst_name, 0) + half_tax
            tax_ledger_totals[sgst_name] = tax_ledger_totals.get(sgst_name, 0) + remainder

    # Build ledger entries in correct Tally order:
    # 1. Party Ledger (CREDIT - positive)
    # 2. Purchase Ledgers (DEBIT - negative)
    # 3. Tax Ledgers (DEBIT - negative)
    
    ledger_entries_xml = ""
    
    # 1. Party Ledger Entry
    ledger_entries_xml += f"""
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>{esc(party_name)}</LEDGERNAME>
       <GSTCLASS>&#4; Not Applicable</GSTCLASS>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <LEDGERFROMITEM>No</LEDGERFROMITEM>
       <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <GSTOVERRIDDEN>No</GSTOVERRIDDEN>
       <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
       <STRDISGSTAPPLICABLE>No</STRDISGSTAPPLICABLE>
       <STRDGSTISPARTYLEDGER>No</STRDGSTISPARTYLEDGER>
       <STRDGSTISDUTYLEDGER>No</STRDGSTISDUTYLEDGER>
       <CONTENTNEGISPOS>No</CONTENTNEGISPOS>
       <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
       <ISCAPVATTAXALTERED>No</ISCAPVATTAXALTERED>
       <ISCAPVATNOTCLAIMED>No</ISCAPVATNOTCLAIMED>
       <AMOUNT>{round_val(total_voucher_value):.2f}</AMOUNT>
      </LEDGERENTRIES.LIST>"""

    # 2. Purchase Ledgers
    for rate_str, amount in purchase_ledger_totals.items():
        purchase_name = f"PURCHASE @{rate_str}"
        ledger_entries_xml += f"""
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>{purchase_name}</LEDGERNAME>
       <GSTCLASS>&#4; Not Applicable</GSTCLASS>
       <GSTOVRDNINELIGIBLEITC>&#4; Applicable</GSTOVRDNINELIGIBLEITC>
       <GSTOVRDNISREVCHARGEAPPL>&#4; Not Applicable</GSTOVRDNISREVCHARGEAPPL>
       <GSTOVRDNSTOREDNATURE/>
       <GSTOVRDNTYPEOFSUPPLY>Services</GSTOVRDNTYPEOFSUPPLY>
       <GSTRATEINFERAPPLICABILITY>As per Masters/Company</GSTRATEINFERAPPLICABILITY>
       <GSTHSNINFERAPPLICABILITY>As per Masters/Company</GSTHSNINFERAPPLICABILITY>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <LEDGERFROMITEM>No</LEDGERFROMITEM>
       <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <GSTOVERRIDDEN>No</GSTOVERRIDDEN>
       <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
       <STRDISGSTAPPLICABLE>No</STRDISGSTAPPLICABLE>
       <STRDGSTISPARTYLEDGER>No</STRDGSTISPARTYLEDGER>
       <STRDGSTISDUTYLEDGER>No</STRDGSTISDUTYLEDGER>
       <CONTENTNEGISPOS>No</CONTENTNEGISPOS>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <ISCAPVATTAXALTERED>No</ISCAPVATTAXALTERED>
       <ISCAPVATNOTCLAIMED>No</ISCAPVATNOTCLAIMED>
       <AMOUNT>{-abs(amount):.2f}</AMOUNT>
       <VATEXPAMOUNT>{-abs(amount):.2f}</VATEXPAMOUNT>
       <SERVICETAXDETAILS.LIST>       </SERVICETAXDETAILS.LIST>
       <BANKALLOCATIONS.LIST>       </BANKALLOCATIONS.LIST>
       <BILLALLOCATIONS.LIST>       </BILLALLOCATIONS.LIST>
       <INTERESTCOLLECTION.LIST>       </INTERESTCOLLECTION.LIST>
       <OLDAUDITENTRIES.LIST>       </OLDAUDITENTRIES.LIST>
       <ACCOUNTAUDITENTRIES.LIST>       </ACCOUNTAUDITENTRIES.LIST>
       <AUDITENTRIES.LIST>       </AUDITENTRIES.LIST>
       <INPUTCRALLOCS.LIST>       </INPUTCRALLOCS.LIST>
       <DUTYHEADDETAILS.LIST>       </DUTYHEADDETAILS.LIST>
       <EXCISEDUTYHEADDETAILS.LIST>       </EXCISEDUTYHEADDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>
       </RATEDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD>
       </RATEDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD>
       </RATEDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>Cess</GSTRATEDUTYHEAD>
       </RATEDETAILS.LIST>
       <RATEDETAILS.LIST>
        <GSTRATEDUTYHEAD>State Cess</GSTRATEDUTYHEAD>
       </RATEDETAILS.LIST>
       <SUMMARYALLOCS.LIST>       </SUMMARYALLOCS.LIST>
       <CENVATDUTYALLOCATIONS.LIST>       </CENVATDUTYALLOCATIONS.LIST>
       <STPYMTDETAILS.LIST>       </STPYMTDETAILS.LIST>
       <EXCISEPAYMENTALLOCATIONS.LIST>       </EXCISEPAYMENTALLOCATIONS.LIST>
       <TAXBILLALLOCATIONS.LIST>       </TAXBILLALLOCATIONS.LIST>
       <TAXOBJECTALLOCATIONS.LIST>       </TAXOBJECTALLOCATIONS.LIST>
       <TDSEXPENSEALLOCATIONS.LIST>       </TDSEXPENSEALLOCATIONS.LIST>
       <VATSTATUTORYDETAILS.LIST>       </VATSTATUTORYDETAILS.LIST>
       <COSTTRACKALLOCATIONS.LIST>       </COSTTRACKALLOCATIONS.LIST>
       <REFVOUCHERDETAILS.LIST>       </REFVOUCHERDETAILS.LIST>
       <INVOICEWISEDETAILS.LIST>       </INVOICEWISEDETAILS.LIST>
       <VATITCDETAILS.LIST>       </VATITCDETAILS.LIST>
       <ADVANCETAXDETAILS.LIST>       </ADVANCETAXDETAILS.LIST>
       <TAXTYPEALLOCATIONS.LIST>       </TAXTYPEALLOCATIONS.LIST>
      </LEDGERENTRIES.LIST>"""

    # 3. Tax Ledgers
    for tax_name, raw_amt in tax_ledger_totals.items():
        amt = round_val(raw_amt)
        if amt > 0:
            tax_amt_str = f"{-abs(amt):.2f}"
            
            # Extract rate from ledger name
            rate_match = re.search(r'(\d+(?:\.\d+)?)', tax_name)
            rate_str = rate_match.group(1) if rate_match else "0"
            
            ledger_entries_xml += f"""
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <RATEOFINVOICETAX.LIST TYPE="Number">
        <RATEOFINVOICETAX> {rate_str}</RATEOFINVOICETAX>
       </RATEOFINVOICETAX.LIST>
       <APPROPRIATEFOR>&#4; Not Applicable</APPROPRIATEFOR>
       <ROUNDTYPE>&#4; Not Applicable</ROUNDTYPE>
       <LEDGERNAME>{tax_name}</LEDGERNAME>
       <GSTCLASS>&#4; Not Applicable</GSTCLASS>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <LEDGERFROMITEM>No</LEDGERFROMITEM>
       <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <GSTOVERRIDDEN>No</GSTOVERRIDDEN>
       <ISGSTASSESSABLEVALUEOVERRIDDEN>No</ISGSTASSESSABLEVALUEOVERRIDDEN>
       <STRDISGSTAPPLICABLE>No</STRDISGSTAPPLICABLE>
       <STRDGSTISPARTYLEDGER>No</STRDGSTISPARTYLEDGER>
       <STRDGSTISDUTYLEDGER>No</STRDGSTISDUTYLEDGER>
       <CONTENTNEGISPOS>No</CONTENTNEGISPOS>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <ISCAPVATTAXALTERED>No</ISCAPVATTAXALTERED>
       <ISCAPVATNOTCLAIMED>No</ISCAPVATNOTCLAIMED>
       <AMOUNT>{tax_amt_str}</AMOUNT>
       <VATEXPAMOUNT>{tax_amt_str}</VATEXPAMOUNT>
       <SERVICETAXDETAILS.LIST>       </SERVICETAXDETAILS.LIST>
       <BANKALLOCATIONS.LIST>       </BANKALLOCATIONS.LIST>
       <BILLALLOCATIONS.LIST>       </BILLALLOCATIONS.LIST>
       <INTERESTCOLLECTION.LIST>       </INTERESTCOLLECTION.LIST>
       <OLDAUDITENTRIES.LIST>       </OLDAUDITENTRIES.LIST>
       <ACCOUNTAUDITENTRIES.LIST>       </ACCOUNTAUDITENTRIES.LIST>
       <AUDITENTRIES.LIST>       </AUDITENTRIES.LIST>
       <INPUTCRALLOCS.LIST>       </INPUTCRALLOCS.LIST>
       <DUTYHEADDETAILS.LIST>       </DUTYHEADDETAILS.LIST>
       <EXCISEDUTYHEADDETAILS.LIST>       </EXCISEDUTYHEADDETAILS.LIST>
       <RATEDETAILS.LIST>       </RATEDETAILS.LIST>
       <SUMMARYALLOCS.LIST>       </SUMMARYALLOCS.LIST>
       <CENVATDUTYALLOCATIONS.LIST>       </CENVATDUTYALLOCATIONS.LIST>
       <STPYMTDETAILS.LIST>       </STPYMTDETAILS.LIST>
       <EXCISEPAYMENTALLOCATIONS.LIST>       </EXCISEPAYMENTALLOCATIONS.LIST>
       <TAXBILLALLOCATIONS.LIST>       </TAXBILLALLOCATIONS.LIST>
       <TAXOBJECTALLOCATIONS.LIST>       </TAXOBJECTALLOCATIONS.LIST>
       <TDSEXPENSEALLOCATIONS.LIST>       </TDSEXPENSEALLOCATIONS.LIST>
       <VATSTATUTORYDETAILS.LIST>       </VATSTATUTORYDETAILS.LIST>
       <COSTTRACKALLOCATIONS.LIST>       </COSTTRACKALLOCATIONS.LIST>
       <REFVOUCHERDETAILS.LIST>       </REFVOUCHERDETAILS.LIST>
       <INVOICEWISEDETAILS.LIST>       </INVOICEWISEDETAILS.LIST>
       <VATITCDETAILS.LIST>       </VATITCDETAILS.LIST>
       <ADVANCETAXDETAILS.LIST>       </ADVANCETAXDETAILS.LIST>
       <TAXTYPEALLOCATIONS.LIST>       </TAXTYPEALLOCATIONS.LIST>
      </LEDGERENTRIES.LIST>"""

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
          <SVCURRENTCOMPANY>{esc('##SVCurrentCompany')}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>{masters_xml}</REQUESTDATA>
    </IMPORTDATA>

    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>{esc('##SVCurrentCompany')}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>

      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER REMOTEID="{esc(remote_id)}" VCHKEY="{esc(vch_key)}" VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <BASICBUYERADDRESS.LIST TYPE="String">
             <BASICBUYERADDRESS>Maharashtra</BASICBUYERADDRESS>
            </BASICBUYERADDRESS.LIST>
            <OLDAUDITENTRYIDS.LIST TYPE="Number">
             <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>
            <DATE>{date_xml}</DATE>
            <REFERENCEDATE>{date_xml}</REFERENCEDATE>
            <VCHSTATUSDATE>{date_xml}</VCHSTATUSDATE>
            <GUID>{esc(guid)}</GUID>
            <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
            <VATDEALERTYPE>Regular</VATDEALERTYPE>
            <STATENAME>Maharashtra</STATENAME>
            <NARRATION>Being as per Invoice</NARRATION>
            <OBJECTUPDATEACTION>Create</OBJECTUPDATEACTION>
            <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
            {f'<PARTYGSTIN>{esc(party_gstin)}</PARTYGSTIN>' if party_gstin else ''}
            <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
            <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            <PARTYNAME>{esc(party_name)}</PARTYNAME>
            <PARTYLEDGERNAME>{esc(party_name)}</PARTYLEDGERNAME>
            <VOUCHERNUMBER>{esc(invoice_number)}</VOUCHERNUMBER>
            <BASICBUYERNAME>{esc(buyer_name_str)}</BASICBUYERNAME>
            <REFERENCE>{esc(invoice_number)}</REFERENCE>
            <PARTYMAILINGNAME>{esc(party_name)}</PARTYMAILINGNAME>
            <NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
            <CSTFORMISSUETYPE>&#4; Not Applicable</CSTFORMISSUETYPE>
            <CSTFORMRECVTYPE>&#4; Not Applicable</CSTFORMRECVTYPE>
            <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <VCHSTATUSTAXADJUSTMENT>Default</VCHSTATUSTAXADJUSTMENT>
            <VCHSTATUSVOUCHERTYPE>Purchase</VCHSTATUSVOUCHERTYPE>
            <DIFFACTUALQTY>No</DIFFACTUALQTY>
            <ISMSTFROMSYNC>No</ISMSTFROMSYNC>
            <ISDELETED>No</ISDELETED>
            <ISOPTIONAL>No</ISOPTIONAL>
            <EFFECTIVEDATE>{date_xml}</EFFECTIVEDATE>
            <ISELIGIBLEFORITC>Yes</ISELIGIBLEFORITC>
            <EWAYBILLDETAILS.LIST>      </EWAYBILLDETAILS.LIST>
            <EXCLUDEDTAXATIONS.LIST>      </EXCLUDEDTAXATIONS.LIST>
            <OLDAUDITENTRIES.LIST>      </OLDAUDITENTRIES.LIST>
            <ACCOUNTAUDITENTRIES.LIST>      </ACCOUNTAUDITENTRIES.LIST>
            <AUDITENTRIES.LIST>      </AUDITENTRIES.LIST>
            <DUTYHEADDETAILS.LIST>      </DUTYHEADDETAILS.LIST>
            <GSTADVADJDETAILS.LIST>      </GSTADVADJDETAILS.LIST>
            <ALLINVENTORYENTRIES.LIST>      </ALLINVENTORYENTRIES.LIST>
            <CONTRITRANS.LIST>      </CONTRITRANS.LIST>
            <EWAYBILLERRORLIST.LIST>      </EWAYBILLERRORLIST.LIST>
            <IRNERRORLIST.LIST>      </IRNERRORLIST.LIST>
            <HARYANAVAT.LIST>      </HARYANAVAT.LIST>
            <SUPPLEMENTARYDUTYHEADDETAILS.LIST>      </SUPPLEMENTARYDUTYHEADDETAILS.LIST>
            <INVOICEDELNOTES.LIST>      </INVOICEDELNOTES.LIST>
            <INVOICEORDERLIST.LIST>      </INVOICEORDERLIST.LIST>
            <INVOICEINDENTLIST.LIST>      </INVOICEINDENTLIST.LIST>
            <ATTENDANCEENTRIES.LIST>      </ATTENDANCEENTRIES.LIST>
            <ORIGINVOICEDETAILS.LIST>      </ORIGINVOICEDETAILS.LIST>
            <INVOICEEXPORTLIST.LIST>      </INVOICEEXPORTLIST.LIST>
            {ledger_entries_xml}
            <GST.LIST>      </GST.LIST>
            <STKJRNLADDLCOSTDETAILS.LIST>      </STKJRNLADDLCOSTDETAILS.LIST>
            <PAYROLLMODEOFPAYMENT.LIST>      </PAYROLLMODEOFPAYMENT.LIST>
            <ATTDRECORDS.LIST>      </ATTDRECORDS.LIST>
            <GSTEWAYCONSIGNORADDRESS.LIST>      </GSTEWAYCONSIGNORADDRESS.LIST>
            <GSTEWAYCONSIGNEEADDRESS.LIST>      </GSTEWAYCONSIGNEEADDRESS.LIST>
            <TEMPGSTRATEDETAILS.LIST>      </TEMPGSTRATEDETAILS.LIST>
            <TEMPGSTADVADJUSTED.LIST>      </TEMPGSTADVADJUSTED.LIST>
            <GSTBUYERADDRESS.LIST>      </GSTBUYERADDRESS.LIST>
            <GSTCONSIGNEEADDRESS.LIST>      </GSTCONSIGNEEADDRESS.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
         <COMPANY>
          <REMOTECMPINFO.LIST MERGE="Yes">
           <NAME>{esc(remote_id)}</NAME>
           <REMOTECMPNAME>##SVCurrentCompany</REMOTECMPNAME>
           <REMOTECMPSTATE>Maharashtra</REMOTECMPSTATE>
          </REMOTECMPINFO.LIST>
         </COMPANY>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""
def generate_bank_statement_xml(data: Dict[str, Any], existing_ledgers: Optional[Set[str]] = None) -> str:
    """
    Converts parsed bank statement into Tally XML
    Payment → Withdrawals
    Receipt → Deposits
    Contra → Internal transfers

    data = {
        bankName: str,
        transactions: [
            {
                date: "2025-01-01",
                description: "...",
                type: "Payment" | "Receipt" | "Contra",
                debit: float,
                credit: float,
                contraLedger: str,
            }
        ]
    }
    """
    if existing_ledgers is None:
        existing_ledgers = set()

    bank_ledger = data.get("bankName", "Bank Account")
    transactions = data.get("transactions", [])

    xml_entries = []

    for tx in transactions:
        date = tx.get("date") or ""
        description = tx.get("description") or "Bank Transaction"
        txn_type = tx.get("type") or "Payment"
        debit = float(tx.get("debit") or 0)
        credit = float(tx.get("credit") or 0)
        contra = tx.get("contraLedger") or "Suspense A/c"

        # Format date for Tally (YYYYMMDD)
        formatted_date = "".join(date.split("-")) if len(date.split("-")) == 3 else ""

        # Determine amount sign
        if txn_type == "Payment":       # Money going OUT of bank
            bank_amount = -abs(debit)
            contra_amount = abs(debit)
        elif txn_type == "Receipt":     # Money coming IN
            bank_amount = abs(credit)
            contra_amount = -abs(credit)
        else:  # CONTRA
            bank_amount = abs(credit) if credit else -abs(debit)
            contra_amount = -bank_amount

        voucher = f"""
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Bank" ACTION="Create">
            <DATE>{formatted_date}</DATE>
            <NARRATION>{esc(description)}</NARRATION>

            <!-- Bank Ledger -->
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(bank_ledger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>{'Yes' if bank_amount < 0 else 'No'}</ISDEEMEDPOSITIVE>
              <AMOUNT>{bank_amount}</AMOUNT>
            </LEDGERENTRIES.LIST>

            <!-- Contra Ledger -->
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>{esc(contra)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>{'Yes' if contra_amount < 0 else 'No'}</ISDEEMEDPOSITIVE>
              <AMOUNT>{contra_amount}</AMOUNT>
            </LEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
        """

        xml_entries.append(voucher)

    full_xml = f"""
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        {''.join(xml_entries)}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
"""

    return full_xml

def check_tally_connection() -> Dict[str, Any]:
    try:
        response = requests.get("http://localhost:9000/health", timeout=5)
        return {"online": response.status_code == 200, "info": "Tally health checked"}
    except Exception as e:
        return {"online": False, "info": str(e)}

def fetch_existing_ledgers() -> Set[str]:
    return set()

def fetch_open_companies() -> List[str]:
    return []
def push_to_tally(xml: str) -> Dict[str, Any]:
    try:
        response = requests.post("http://localhost:9000", data=xml, headers={"Content-Type": "text/plain"}, timeout=30)
        text = response.text
        if "<LINEERROR>" in text:
            m = re.search(r"<LINEERROR>(.*?)</LINEERROR>", text)
            return {"success": False, "message": m.group(1) if m else "Tally Line Error"}
        created_m = re.search(r"<CREATED>(\d+)</CREATED>", text)
        created = int(created_m.group(1)) if created_m else 0
        errors_m = re.search(r"<ERRORS>(\d+)</ERRORS>", text)
        errors = int(errors_m.group(1)) if errors_m else 0
        if errors > 0:
            return {"success": False, "message": f"Tally reported {errors} errors"}
        if created > 0:
            return {"success": True, "message": f"Created {created}"}
        return {"success": False, "message": "Tally ignored request"}
    except Exception as e:
        return {"success": False, "message": str(e)}

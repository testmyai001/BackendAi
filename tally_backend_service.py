"""
Tally Backend Service - Handles all Tally XML generation and API communication
Moves Excel import logic from React frontend to FastAPI backend to avoid CORS issues
"""

import requests
import re
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Tuple, Set
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

TALLY_URL = "http://localhost:9000"


class TallyBackendService:
    """Handles all Tally operations server-side"""

    # State codes mapping - Complete GSTIN state codes
    STATE_CODES = {
        "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
        "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
        "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
        "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
        "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
        "16": "Tripura", "17": "Meghalaya", "18": "Assam",
        "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
        "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
        "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
        "28": "Karnataka", "29": "Goa", "30": "Lakshadweep",
        "31": "Kerala", "32": "Tamil Nadu", "33": "Puducherry",
        "34": "Andaman & Nicobar Islands", "35": "Telangana",
        "36": "Andhra Pradesh", "37": "Ladakh"
    }

    @staticmethod
    def escape_xml(text: str) -> str:
        """Escape XML special characters"""
        if not text:
            return ""
        return (
            str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    @staticmethod
    def clean_name(name: str, max_length: int = 50) -> str:
        """Sanitize names for Tally - alphanumeric, spaces, hyphens, dots, parentheses"""
        if not name:
            return "Unnamed"
        # Keep only safe characters
        cleaned = re.sub(r'[^a-zA-Z0-9\s\-\.\(\)%]', '', str(name)).strip()
        return cleaned[:max_length] if cleaned else "Unnamed"

    @staticmethod
    def round_amount(amount: float) -> float:
        """Round to 2 decimal places with precision"""
        return round((amount + 1e-9) * 100) / 100

    @staticmethod
    def get_state_from_gstin(gstin: str) -> str:
        """Extract state name from GSTIN first 2 digits with validation"""
        if not gstin or len(gstin) < 2:
            return "Maharashtra"  # Default
        
        state_code = str(gstin)[:2].strip()
        
        # Validate state code is numeric and exists
        if not state_code.isdigit():
            return "Maharashtra"
        
        state = TallyBackendService.STATE_CODES.get(state_code)
        if not state:
            logger.warning(f"Unknown state code: {state_code}, defaulting to Maharashtra")
            return "Maharashtra"
        
        return state

    @staticmethod
    def check_tally_connection() -> bool:
        """Check if Tally is running"""
        try:
            response = requests.get(f"{TALLY_URL}/health", timeout=3)
            return response.status_code == 200
        except:
            return False

    @staticmethod
    def fetch_existing_ledgers() -> Set[str]:
        """
        Fetch list of existing ledgers from Tally
        Uses proper server-side request without CORS issues
        """
        try:
            # Query to export existing ledgers
            query_xml = """
            <ENVELOPE>
                <HEADER>
                    <TALLYREQUEST>Export</TALLYREQUEST>
                </HEADER>
                <BODY>
                    <EXPORTDATA>
                        <REQUESTDESC>
                            <REPORTNAME>List of Accounts</REPORTNAME>
                        </REQUESTDESC>
                    </EXPORTDATA>
                </BODY>
            </ENVELOPE>
            """
            
            response = requests.post(
                TALLY_URL,
                data=query_xml,
                timeout=5,
                headers={"Content-Type": "application/xml"}
            )
            
            if response.status_code == 200:
                # Parse XML response to extract ledger names
                ledgers = set()
                # Find all LEDGER entries
                matches = re.findall(r'<LEDGER[^>]*>.*?<NAME>([^<]+)</NAME>', response.text, re.DOTALL)
                ledgers.update(matches)
                
                if ledgers:
                    logger.info(f"Fetched {len(ledgers)} existing ledgers from Tally")
                return ledgers
            else:
                logger.warning(f"Failed to fetch ledgers: HTTP {response.status_code}")
                return set()
        except Exception as e:
            logger.error(f"Error fetching existing ledgers: {e}")
            return set()

    def generate_excel_import_xml(
        self,
        vouchers: List[Dict[str, Any]],
        company_name: str = "##SVCurrentCompany",
        create_masters: bool = True,
    ) -> str:
        """
        Generate Tally XML for bulk Excel import
        
        Voucher structure:
        {
            'id': str,
            'date': 'YYYY-MM-DD',
            'invoiceNo': str,
            'partyName': str,
            'gstin': str,
            'voucherType': 'Purchase' | 'Sales',
            'items': [
                {'amount': float, 'taxRate': float, 'ledgerName': str (optional)}
            ],
            'totalAmount': float
        }
        """
        if not vouchers:
            return ""

        masters_xml = ""
        created_masters = set()

        # 1. Create Masters if required
        if create_masters:
            masters_xml = self._generate_masters(vouchers, created_masters)

        # 2. Create Vouchers
        vouchers_xml = self._generate_vouchers(vouchers)

        # 3. Build final XML
        final_xml = f"""
<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>All Masters</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{self.escape_xml(company_name)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                {masters_xml}
            </REQUESTDATA>
        </IMPORTDATA>

        <IMPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>Vouchers</REPORTNAME>
                <STATICVARIABLES>
                    <SVCURRENTCOMPANY>{self.escape_xml(company_name)}</SVCURRENTCOMPANY>
                </STATICVARIABLES>
            </REQUESTDESC>
            <REQUESTDATA>
                {vouchers_xml}
            </REQUESTDATA>
        </IMPORTDATA>
    </BODY>
</ENVELOPE>
"""
        return final_xml

    def _generate_masters(self, vouchers: List[Dict[str, Any]], created_set: Set[str]) -> str:
        """Generate master ledgers for parties, items, and taxes"""
        masters_xml = ""

        for voucher in vouchers:
            party_name = self.clean_name(voucher.get("partyName", "Party"))
            gstin = str(voucher.get("gstin", "")).strip().upper()
            is_valid_gstin = len(gstin) == 15
            state = self.get_state_from_gstin(gstin) if is_valid_gstin else "Maharashtra"

            # 1. Create Party Ledger
            if party_name not in created_set:
                group = "Sundry Debtors" if voucher["voucherType"] == "Sales" else "Sundry Creditors"
                party_xml = f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <LEDGER NAME="{self.escape_xml(party_name)}" ACTION="Create">
                    <NAME.LIST><NAME>{self.escape_xml(party_name)}</NAME></NAME.LIST>
                    <PARENT>{group}</PARENT>
                    <ISBILLWISEON>Yes</ISBILLWISEON>
                    <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                    {f'<PARTYGSTIN>{self.escape_xml(gstin)}</PARTYGSTIN>' if is_valid_gstin else ''}
                    {f'<STATENAME>{self.escape_xml(state)}</STATENAME>' if state else ''}
                </LEDGER>
            </TALLYMESSAGE>"""
                masters_xml += party_xml
                created_set.add(party_name)

            # 2. Create Item and Tax Ledgers
            for item in voucher.get("items", []):
                tax_rate = item.get("taxRate", 0)
                rate_str = f"{int(tax_rate) if tax_rate == int(tax_rate) else tax_rate}%"
                item_ledger_name = f"PURCHASE @{rate_str}"

                if item_ledger_name not in created_set:
                    parent = "Purchase Accounts"
                    item_xml = f"""
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <LEDGER NAME="{self.escape_xml(item_ledger_name)}" ACTION="Create">
                        <NAME.LIST><NAME>{self.escape_xml(item_ledger_name)}</NAME></NAME.LIST>
                        <PARENT>{parent}</PARENT>
                        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                        <GSTRATE>{tax_rate}</GSTRATE>
                    </LEDGER>
                </TALLYMESSAGE>"""
                    masters_xml += item_xml
                    created_set.add(item_ledger_name)

                # 3. Create Tax Ledgers (CGST/SGST or IGST)
                if tax_rate > 0:
                    is_inter_state = is_valid_gstin and gstin[:2] != "27"  # Assuming 27 = home state

                    if is_inter_state:
                        # Inter-state: IGST at full rate
                        igst_name = f"Input IGST {self._format_rate(tax_rate)}%"

                        if igst_name not in created_set:
                            igst_xml = f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <LEDGER NAME="{self.escape_xml(igst_name)}" ACTION="Create">
                    <NAME.LIST><NAME>{self.escape_xml(igst_name)}</NAME></NAME.LIST>
                    <PARENT>Duties &amp; Taxes</PARENT>
                    <TAXTYPE>GST</TAXTYPE>
                    <GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>
                    <GSTRATE>{tax_rate}</GSTRATE>
                </LEDGER>
            </TALLYMESSAGE>"""
                            masters_xml += igst_xml
                            created_set.add(igst_name)
                    else:
                        # Intra-state: CGST + SGST (50/50 split)
                        half_rate = tax_rate / 2
                        cgst_rate_str = self._format_rate(half_rate)
                        sgst_rate_str = self._format_rate(half_rate)
                        cgst_name = f"Input CGST@{cgst_rate_str}%"
                        sgst_name = f"Input SGST@{sgst_rate_str}%"

                        for tax_name, duty_head, rate in [
                            (cgst_name, "Central Tax", half_rate),
                            (sgst_name, "State Tax", half_rate)
                        ]:
                            if tax_name not in created_set:
                                tax_xml = f"""
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <LEDGER NAME="{self.escape_xml(tax_name)}" ACTION="Create">
                    <NAME.LIST><NAME>{self.escape_xml(tax_name)}</NAME></NAME.LIST>
                    <PARENT>Duties &amp; Taxes</PARENT>
                    <TAXTYPE>GST</TAXTYPE>
                    <GSTDUTYHEAD>{duty_head}</GSTDUTYHEAD>
                    <GSTRATE>{rate}</GSTRATE>
                </LEDGER>
            </TALLYMESSAGE>"""
                                masters_xml += tax_xml
                                created_set.add(tax_name)

        return masters_xml

    def _generate_vouchers(self, vouchers: List[Dict[str, Any]]) -> str:
        """Generate voucher entries with proper ledger entries matching Tally structure"""
        vouchers_xml = ""

        for voucher in vouchers:
            date_obj = datetime.strptime(voucher["date"], "%Y-%m-%d")
            date_xml = date_obj.strftime("%Y%m%d")
            
            party_name = self.clean_name(voucher.get("partyName", "Party"))
            invoice_no = voucher.get("invoiceNo", "")
            is_sales = voucher["voucherType"] == "Sales"
            gstin = str(voucher.get("gstin", "")).strip().upper()
            is_valid_gstin = len(gstin) == 15
            
            # Determine if inter-state (home state = 27 Maharashtra)
            is_inter_state = is_valid_gstin and gstin[:2] != "27"

            # Calculate totals and track taxes by rate
            total_purchase_amount = 0.0
            tax_ledgers: Dict[str, float] = {}  # {ledger_name: amount}
            purchase_ledgers: Dict[str, float] = {}  # {rate: amount}

            # Process items and calculate totals
            for item in voucher.get("items", []):
                amount = self.round_amount(item.get("amount", 0))
                tax_rate = item.get("taxRate", 0)

                if amount <= 0:
                    continue

                # Track purchase amount by rate
                rate_key = f"{int(tax_rate) if tax_rate == int(tax_rate) else tax_rate}%"
                purchase_ledgers[rate_key] = purchase_ledgers.get(rate_key, 0) + amount
                total_purchase_amount += amount

                # Calculate and track taxes
                if tax_rate > 0:
                    tax_amount = self.round_amount(amount * (tax_rate / 100))

                    if is_inter_state:
                        # Inter-state: Single IGST ledger
                        igst_name = f"Input IGST {self._format_rate(tax_rate)}%"
                        tax_ledgers[igst_name] = tax_ledgers.get(igst_name, 0) + tax_amount
                    else:
                        # Intra-state: Split CGST + SGST
                        half_rate = tax_rate / 2
                        cgst_rate_str = self._format_rate(half_rate)
                        sgst_rate_str = self._format_rate(half_rate)
                        
                        cgst_name = f"Input CGST@{cgst_rate_str}%"
                        sgst_name = f"Input SGST@{sgst_rate_str}%"

                        half_tax = self.round_amount(tax_amount / 2)
                        remainder = self.round_amount(tax_amount - half_tax)
                        
                        tax_ledgers[cgst_name] = tax_ledgers.get(cgst_name, 0) + half_tax
                        tax_ledgers[sgst_name] = tax_ledgers.get(sgst_name, 0) + remainder

            # Build LEDGERENTRIES.LIST in correct order:
            # 1. Party Ledger (ISPARTYLEDGER=Yes, ISDEEMEDPOSITIVE=No, AMOUNT=positive)
            # 2. Purchase Ledgers (ISPARTYLEDGER=No, ISDEEMEDPOSITIVE=Yes, AMOUNT=negative)
            # 3. Tax Ledgers (ISPARTYLEDGER=No, ISDEEMEDPOSITIVE=Yes, AMOUNT=negative)

            ledger_entries_xml = ""

            # 1. Party Ledger Entry (CREDIT - Sundry Creditors)
            final_total = self.round_amount(total_purchase_amount + sum(tax_ledgers.values()))
            party_amount = f"{final_total:.2f}"  # Positive for party (credit)

            ledger_entries_xml += f"""
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>{self.escape_xml(party_name)}</LEDGERNAME>
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
       <AMOUNT>{party_amount}</AMOUNT>
      </LEDGERENTRIES.LIST>"""

            # 2. Purchase Ledgers (DEBIT)
            for rate_key, amount in purchase_ledgers.items():
                purchase_ledger_name = f"PURCHASE @{rate_key}"
                purchase_amount = f"{-abs(amount):.2f}"  # Negative for debit

                ledger_entries_xml += f"""
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>{purchase_ledger_name}</LEDGERNAME>
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
       <AMOUNT>{purchase_amount}</AMOUNT>
       <VATEXPAMOUNT>{purchase_amount}</VATEXPAMOUNT>
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

            # 3. Tax Ledgers (DEBIT)
            for tax_ledger_name, tax_amount in tax_ledgers.items():
                if tax_amount > 0:
                    tax_amount_str = f"{-abs(tax_amount):.2f}"  # Negative for debit
                    
                    # Extract rate from ledger name (e.g., "Input CGST@6%" -> 6)
                    rate_match = re.search(r'(\d+(?:\.\d+)?)', tax_ledger_name)
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
       <LEDGERNAME>{tax_ledger_name}</LEDGERNAME>
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
       <AMOUNT>{tax_amount_str}</AMOUNT>
       <VATEXPAMOUNT>{tax_amount_str}</VATEXPAMOUNT>
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

            # Build Complete Voucher
            voucher_xml = f"""
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER REMOTEID="{self.escape_xml(str(id(voucher)))}" VCHKEY="{self.escape_xml(f'{id(voucher)}:000000c8')}" VCHTYPE="{voucher['voucherType']}" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>{date_xml}</DATE>
      <REFERENCEDATE>{date_xml}</REFERENCEDATE>
      <VCHSTATUSDATE>{date_xml}</VCHSTATUSDATE>
      <GUID>{self.escape_xml(str(id(voucher)))}</GUID>
      <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
      <VATDEALERTYPE>Regular</VATDEALERTYPE>
      <STATENAME>Maharashtra</STATENAME>
      <NARRATION>Invoice: {self.escape_xml(invoice_no)}</NARRATION>
      <OBJECTUPDATEACTION>Create</OBJECTUPDATEACTION>
      <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
      {f'<PARTYGSTIN>{self.escape_xml(gstin)}</PARTYGSTIN>' if is_valid_gstin else ''}
      <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
      <VOUCHERTYPENAME>{voucher['voucherType']}</VOUCHERTYPENAME>
      <PARTYNAME>{self.escape_xml(party_name)}</PARTYNAME>
      <PARTYLEDGERNAME>{self.escape_xml(party_name)}</PARTYLEDGERNAME>
      <VOUCHERNUMBER>{self.escape_xml(invoice_no)}</VOUCHERNUMBER>
      <REFERENCE>{self.escape_xml(invoice_no)}</REFERENCE>
      <PARTYMAILINGNAME>{self.escape_xml(party_name)}</PARTYMAILINGNAME>
      <NUMBERINGSTYLE>Manual</NUMBERINGSTYLE>
      <CSTFORMISSUETYPE>&#4; Not Applicable</CSTFORMISSUETYPE>
      <CSTFORMRECVTYPE>&#4; Not Applicable</CSTFORMRECVTYPE>
      <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
      <VCHSTATUSTAXADJUSTMENT>Default</VCHSTATUSTAXADJUSTMENT>
      <VCHSTATUSVOUCHERTYPE>{voucher['voucherType']}</VCHSTATUSVOUCHERTYPE>
      <DIFFACTUALQTY>No</DIFFACTUALQTY>
      <ISMSTFROMSYNC>No</ISMSTFROMSYNC>
      <ISDELETED>No</ISDELETED>
      <ISOPTIONAL>No</ISOPTIONAL>
      <EFFECTIVEDATE>{date_xml}</EFFECTIVEDATE>
      <ISELIGIBLEFORITC>Yes</ISELIGIBLEFORITC>
      <EWAYBILLDETAILS.LIST>      </EWAYBILLDETAILS.LIST>
      <EXCLUDEDTAXATIONS.LIST>      </EXCLUDEDTAXATIONS.LIST>
      <ALLINVENTORYENTRIES.LIST>      </ALLINVENTORYENTRIES.LIST>
      <CONTRITRANS.LIST>      </CONTRITRANS.LIST>
      {ledger_entries_xml}
      <GST.LIST>      </GST.LIST>
     </VOUCHER>
    </TALLYMESSAGE>"""

            vouchers_xml += voucher_xml

        return vouchers_xml

    @staticmethod
    def _format_rate(rate: float) -> str:
        """Format rate as string (e.g., 2.5, 6, 9)"""
        if rate == int(rate):
            return str(int(rate))
        return f"{rate:.1f}".rstrip('0').rstrip('.')

    def push_vouchers_to_tally(self, xml_payload: str) -> Dict[str, Any]:
        """
        Push generated XML to Tally server
        Parse response to determine success/failure with detailed error reporting
        """
        # Validate XML payload before sending
        if not xml_payload or len(xml_payload.strip()) < 50:
            return {
                "success": False,
                "message": "Invalid XML payload - empty or too short"
            }

        try:
            logger.info(f"Pushing XML payload to Tally ({len(xml_payload)} bytes)")
            
            response = requests.post(
                TALLY_URL,
                data=xml_payload,
                timeout=30,  # Increased timeout for large payloads
                headers={"Content-Type": "application/xml"}
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "message": f"Tally server returned HTTP {response.status_code}",
                    "details": response.text[:500] if response.text else "No response body"
                }

            # Parse response for success/error indicators
            response_text = response.text
            
            # Check for creation success markers
            created_count = len(re.findall(r'<CREATED>|<TALLYMESSAGE[^>]*>(?:[^<]|\n)*<LEDGER', response_text, re.DOTALL))
            
            # Check for errors
            error_tags = re.findall(r'<ERROR[^>]*>([^<]+)</ERROR>', response_text)
            line_errors = re.findall(r'<LINEERROR>([^<]+)</LINEERROR>', response_text)
            import_errors = re.findall(r'<IMPORTERROR>([^<]+)</IMPORTERROR>', response_text)
            
            all_errors = error_tags + line_errors + import_errors
            error_count = len(all_errors)

            # Determine success: No errors reported
            if error_count > 0:
                error_msg = "; ".join(all_errors[:5])  # Limit to first 5 errors
                logger.warning(f"Tally returned errors: {error_msg}")
                return {
                    "success": False,
                    "message": f"Tally import errors: {error_msg}",
                    "createdCount": created_count,
                    "errorCount": error_count
                }

            # Success: No errors, response received
            return {
                "success": True,
                "message": "Successfully imported vouchers to Tally",
                "createdCount": created_count or "Unknown"
            }

        except requests.exceptions.Timeout:
            logger.error("Tally connection timeout")
            return {
                "success": False,
                "message": "Connection to Tally timed out (30s). Ensure Tally is running on localhost:9000"
            }
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Tally connection failed: {e}")
            return {
                "success": False,
                "message": "Cannot connect to Tally on localhost:9000. Is Tally running?"
            }
        except Exception as e:
            logger.error(f"Error pushing to Tally: {str(e)}", exc_info=True)
            return {
                "success": False,
                "message": f"Error: {str(e)}"
            }


# Singleton instance
tally_service = TallyBackendService()

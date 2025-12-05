
import { InvoiceData, TallyResponse, BankStatementData } from '../types';
import { TALLY_API_URL } from '../constants';
import { v4 as uuidv4 } from 'uuid';

// --- HELPER FUNCTIONS ---

const esc = (str: string) => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, ' ');
};

const cleanName = (str: string): string => {
  if (!str) return 'Unknown Item';
  return str.replace(/[^a-zA-Z0-9\s\-\.\(\)%]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 50);
};

const round = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

const formatRate = (num: number): string => {
  return Number.isInteger(num) ? num.toString() : num.toFixed(1).replace(/\.0$/, '');
};

// STRICT TALLY FORMAT: YYYYMMDD
const formatDateForXml = (dateStr: string) => {
  if (!dateStr) {
      const today = new Date();
      return today.toISOString().slice(0, 10).replace(/-/g, ''); 
  }
  const d = dateStr.replace(/[\.\/\s]/g, '-');
  
  // Input: YYYY-MM-DD -> Output: YYYYMMDD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replace(/-/g, '');
  
  // Input: DD-MM-YYYY -> Output: YYYYMMDD
  const match = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) return `${match[3]}${match[2].padStart(2, '0')}${match[1].padStart(2, '0')}`;
  
  const today = new Date();
  return today.toISOString().slice(0, 10).replace(/-/g, '');
};

const STATE_MAP: Record<string, string> = {
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
};

const getStateName = (gstin: string): string => {
    if(!gstin || gstin.length < 2) return '';
    const code = gstin.substring(0, 2);
    return STATE_MAP[code] || '';
};

// Decode HTML entities from Tally response
const decodeHtml = (html: string) => {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
};

// --- CONNECTION CHECK ---
export const checkTallyConnection = async (): Promise<{ online: boolean; info: string; mode: 'full' | 'blind' | 'none' }> => {
  try {
     const controller = new AbortController();
     const id = setTimeout(() => controller.abort(), 3000); 
     await fetch(TALLY_API_URL, {
         method: 'GET',
         mode: 'no-cors', 
         signal: controller.signal
     });
     clearTimeout(id);
     return { online: true, info: "Port Is Open (Connected)", mode: 'blind' };
  } catch (e) {
     let msg = "Unreachable";
     if (e instanceof Error) msg = e.message;
     return { online: false, info: `Offline: ${msg}`, mode: 'none' };
  }
};

export const generateBankStatementXml = (data: BankStatementData, existingLedgers: Set<string> = new Set()): string => {
  const svCompany = '##SVCurrentCompany';
  const bankLedger = esc(data.bankName);
  
  let mastersXml = '';
  
  // 1. Always Ensure Bank Ledger Exists (Create/Update)
  // This prevents "Referenced master is missing" if the user renames the bank in the UI.
  // We UNCONDITIONALLY generate this to force Tally to ensure the ledger exists before vouchers are imported.
  mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${bankLedger}" ACTION="Create">
        <NAME.LIST><NAME>${bankLedger}</NAME></NAME.LIST>
        <PARENT>Bank Accounts</PARENT>
        <ISBILLWISEON>No</ISBILLWISEON>
        <ISGSTAPPLICABLE>No</ISGSTAPPLICABLE>
      </LEDGER>
    </TALLYMESSAGE>`;

  // 2. Check and Create Contra Ledgers if they don't exist
  const uniqueContras = new Set<string>();
  data.transactions.forEach(t => {
      if(t.contraLedger) uniqueContras.add(t.contraLedger);
  });

  uniqueContras.forEach(ledgerName => {
      // Don't recreate the bank ledger here, and don't recreate if exists
      if (ledgerName !== data.bankName && !existingLedgers.has(ledgerName)) {
           mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
        <NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST>
        <PARENT>Suspense A/c</PARENT> <!-- Defaulting to Suspense for safety -->
        <ISGSTAPPLICABLE>No</ISGSTAPPLICABLE>
      </LEDGER>
    </TALLYMESSAGE>`;
      }
  });

  let vouchersXml = '';

  data.transactions.forEach((txn) => {
    const dateXml = formatDateForXml(txn.date);
    const amount = (txn.type === 'Payment' || txn.voucherType === 'Payment') ? txn.debit : txn.credit;
    // const amountStr = amount.toFixed(2); // Not used directly in logic below
    const contraLedger = esc(txn.contraLedger);
    const narration = esc(txn.description);
    
    // Tally Voucher Logic:
    // PAYMENT: Credit Bank, Debit Expense
    // RECEIPT: Debit Bank, Credit Income
    
    // In Tally XML, ISDEEMEDPOSITIVE = Yes means Debit, No means Credit.
    const isPayment = (txn.type === 'Payment' || txn.voucherType === 'Payment');
    
    // Bank Entry
    const bankDeemedPos = isPayment ? 'No' : 'Yes';
    const bankAmountSign = isPayment ? 1 : -1; 
    const bankAmountVal = (amount * bankAmountSign).toFixed(2);

    // Party Entry
    const partyDeemedPos = isPayment ? 'Yes' : 'No';
    const partyAmountSign = isPayment ? -1 : 1;
    const partyAmountVal = (amount * partyAmountSign).toFixed(2);

    vouchersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${txn.voucherType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
        <DATE>${dateXml}</DATE>
        <NARRATION>${narration}</NARRATION>
        <VOUCHERTYPENAME>${txn.voucherType}</VOUCHERTYPENAME>
        <VOUCHERNUMBER>${uuidv4().substring(0,8)}</VOUCHERNUMBER>
        <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
        <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
        
        <!-- BANK ENTRY -->
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${bankLedger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${bankDeemedPos}</ISDEEMEDPOSITIVE>
          <AMOUNT>${bankAmountVal}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>

        <!-- PARTY/EXPENSE ENTRY -->
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${contraLedger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${partyDeemedPos}</ISDEEMEDPOSITIVE>
          <AMOUNT>${partyAmountVal}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>

      </VOUCHER>
    </TALLYMESSAGE>`;
  });

  return `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        ${mastersXml}
      </REQUESTDATA>
    </IMPORTDATA>

    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        ${vouchersXml}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
};

export const generateTallyXml = (data: InvoiceData, existingLedgers: Set<string> = new Set()): string => {
  const isSales = data.voucherType === 'Sales';
  const dateXml = formatDateForXml(data.invoiceDate); 
  
  // Generate IDs similar to Tally's format
  const guid = uuidv4();
  const remoteId = uuidv4();
  const vchKey = `${uuidv4()}:00000008`; // Mimic Tally VCHKEY format

  const svCompany = data.targetCompany && data.targetCompany.trim() ? esc(data.targetCompany) : '##SVCurrentCompany';
  const rawPartyName = (isSales ? data.buyerName : data.supplierName) || "Cash Party";
  const partyName = cleanName(rawPartyName);
  const partyGroup = isSales ? 'Sundry Debtors' : 'Sundry Creditors';
  const ledgerParentGroup = isSales ? 'Sales Accounts' : 'Purchase Accounts';
  const supplierGstin = (data.supplierGstin || '').trim().toUpperCase();
  const buyerGstin = (data.buyerGstin || '').trim().toUpperCase();
  const partyGstin = isSales ? buyerGstin : supplierGstin;
  const partyState = getStateName(partyGstin) || 'Maharashtra'; // Defaulting to Maharashtra as per user example if missing
  const buyerName = data.buyerName || 'Cash Buyer';

  // Logic: Check for Inter-State vs Intra-State
  const sState = supplierGstin.substring(0, 2);
  const bState = buyerGstin.substring(0, 2);
  // If states match and are valid, it's Local (CGST/SGST). Otherwise Inter-State (IGST).
  const isInterState = (sState && bState && sState !== bState);

  // --- SIGNAGE LOGIC MATCHING TALLY EXPORT XML ---
  // Purchase: 
  //   Party (Credit) -> Positive Amount (e.g., 14112) with ISDEEMEDPOSITIVE=No
  //   Item/Tax (Debit) -> Negative Amount (e.g., -12600) with ISDEEMEDPOSITIVE=Yes
  // Sales:
  //   Party (Debit) -> Negative Amount with ISDEEMEDPOSITIVE=Yes
  //   Item/Tax (Credit) -> Positive Amount with ISDEEMEDPOSITIVE=No
  
  const partyDeemedPos = isSales ? 'Yes' : 'No';
  const itemDeemedPos = isSales ? 'No' : 'Yes';
  
  // Purchase (isSales=false): itemSign = -1 (Negative)
  // Sales (isSales=true): itemSign = 1 (Positive)
  const itemSign = isSales ? 1 : -1;
  
  const taxLedgerTotals: Record<string, number> = {};
  let totalVoucherValue = 0; 

  // --- MASTERS GENERATION ---
  let mastersXml = '';

  mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <UNIT NAME="Nos" ACTION="Create">
        <NAME>Nos</NAME>
        <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
      </UNIT>
    </TALLYMESSAGE>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <GROUP NAME="${ledgerParentGroup}" ACTION="Create">
        <NAME.LIST><NAME>${ledgerParentGroup}</NAME></NAME.LIST>
        <PARENT>Primary</PARENT>
      </GROUP>
    </TALLYMESSAGE>`;

  if (!existingLedgers.has(partyName)) {
    mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${esc(partyName)}" ACTION="Create">
        <NAME.LIST><NAME>${esc(partyName)}</NAME></NAME.LIST>
        <PARENT>${partyGroup}</PARENT>
        <ISBILLWISEON>Yes</ISBILLWISEON>
        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
        ${partyGstin ? `<PARTYGSTIN>${esc(partyGstin)}</PARTYGSTIN>` : ''}
        ${partyState ? `<STATENAME>${esc(partyState)}</STATENAME>` : ''}
      </LEDGER>
    </TALLYMESSAGE>`;
  }

  const uniqueRates = new Set<number>();
  data.lineItems.forEach(item => {
    const rate = Number(item.gstRate) || 0;
    uniqueRates.add(rate);
    const itemName = cleanName(item.description) || `Item @ ${rate}%`;
    mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="${esc(itemName)}" ACTION="Create">
        <NAME.LIST><NAME>${esc(itemName)}</NAME></NAME.LIST>
        <PARENT>Primary</PARENT>
        <BASEUNITS>Nos</BASEUNITS>
        <OPENINGBALANCE>0 Nos</OPENINGBALANCE>
        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
        <GSTRATE>${rate}</GSTRATE>
      </STOCKITEM>
    </TALLYMESSAGE>`;
  });

  uniqueRates.forEach(rate => {
    const ledgerName = `${isSales ? 'Sale' : 'Purchase'} ${formatRate(rate)}%`;
    if (!existingLedgers.has(ledgerName)) {
        mastersXml += `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
            <NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST>
            <PARENT>${ledgerParentGroup}</PARENT>
            <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
            <GSTRATE>${rate}</GSTRATE>
        </LEDGER>
        </TALLYMESSAGE>`;
    }
    
    // Auto Create Tax Ledgers
    if (isInterState) {
        const igstName = `${isSales ? 'Output' : 'Input'} IGST ${formatRate(rate)}%`;
        if (!existingLedgers.has(igstName)) {
            mastersXml += `
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="${esc(igstName)}" ACTION="Create">
            <NAME.LIST><NAME>${esc(igstName)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>
            <GSTRATE>${rate}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>`;
        }
    } else {
        const half = rate / 2;
        const cgstName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
        const sgstName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
        if (!existingLedgers.has(cgstName)) {
            mastersXml += `
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="${esc(cgstName)}" ACTION="Create">
            <NAME.LIST><NAME>${esc(cgstName)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>
            <GSTRATE>${half}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>`;
        }
        if (!existingLedgers.has(sgstName)) {
            mastersXml += `
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <LEDGER NAME="${esc(sgstName)}" ACTION="Create">
            <NAME.LIST><NAME>${esc(sgstName)}</NAME></NAME.LIST>
            <PARENT>Duties &amp; Taxes</PARENT>
            <TAXTYPE>GST</TAXTYPE>
            <GSTDUTYHEAD>State Tax</GSTDUTYHEAD>
            <GSTRATE>${half}</GSTRATE>
            </LEDGER>
            </TALLYMESSAGE>`;
        }
    }
  });

  // --- VOUCHER DATA GENERATION ---

  // 1. Inventory XML (ALLINVENTORYENTRIES.LIST)
  let inventoryXml = '';
  data.lineItems.forEach(item => {
    const rate = Number(item.gstRate) || 0;
    const qty = Number(item.quantity) || 1;
    const itemRate = Number(item.rate) || 0;
    
    const amount = round(qty * itemRate);
    const itemName = cleanName(item.description) || `Item @ ${rate}%`;
    const ledgerName = `${isSales ? 'Sale' : 'Purchase'} ${formatRate(rate)}%`;

    totalVoucherValue += amount;
    const lineTax = round(amount * (rate / 100));
    totalVoucherValue += lineTax;

    // TAX SPLIT LOGIC
    if (isInterState) {
        const name = `${isSales ? 'Output' : 'Input'} IGST ${formatRate(rate)}%`;
        taxLedgerTotals[name] = (taxLedgerTotals[name] || 0) + lineTax;
    } else {
        const half = rate / 2;
        const cName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
        const sName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
        const halfTax = round(lineTax / 2);
        const remainder = round(lineTax - halfTax);
        taxLedgerTotals[cName] = (taxLedgerTotals[cName] || 0) + halfTax;
        taxLedgerTotals[sName] = (taxLedgerTotals[sName] || 0) + remainder;
    }

    // Amount Signage: 
    // Purchase: Item is Debit -> Negative Amount (-12600)
    // Sales: Item is Credit -> Positive Amount
    const amountStr = `${(amount * itemSign).toFixed(2)}`;

    inventoryXml += `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE>
          <ACTUALQTY> ${qty} Nos</ACTUALQTY>
          <BILLEDQTY> ${qty} Nos</BILLEDQTY>
          <RATE>${itemRate.toFixed(2)}/Nos</RATE>
          <AMOUNT>${amountStr}</AMOUNT>
          <ACCOUNTINGALLOCATIONS.LIST>
             <LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>
             <ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE>
             <AMOUNT>${amountStr}</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>`;
  });

  // 2. Tax XML (LEDGERENTRIES.LIST)
  let taxLedgersXml = '';
  Object.entries(taxLedgerTotals).forEach(([name, rawAmt]) => {
      const amt = round(rawAmt);
      if (amt > 0) {
        // Tax Signage: Same as Item
        const taxAmtStr = `${(amt * itemSign).toFixed(2)}`; 
        taxLedgersXml += `
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${esc(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE>
          <AMOUNT>${taxAmtStr}</AMOUNT>
        </LEDGERENTRIES.LIST>`;
      }
  });

  // 3. Party Amount
  // Purchase: Party is Credit -> Positive Amount (14112)
  // Sales: Party is Debit -> Negative Amount
  const partySign = isSales ? -1 : 1; 
  const finalPartyTotal = round(totalVoucherValue);
  const partyAmountStr = `${(finalPartyTotal * partySign).toFixed(2)}`;

  return `
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>

  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${mastersXml}</REQUESTDATA>
    </IMPORTDATA>

    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>

      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER 
            REMOTEID="${remoteId}"
            VCHKEY="${vchKey}"
            VCHTYPE="${data.voucherType}"
            ACTION="Create"
            OBJVIEW="Invoice Voucher View">

            <OLDAUDITENTRYIDS.LIST TYPE="Number">
               <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
            </OLDAUDITENTRYIDS.LIST>

            <DATE>${dateXml}</DATE>
            <EFFECTIVEDATE>${dateXml}</EFFECTIVEDATE>
            <REFERENCEDATE>${dateXml}</REFERENCEDATE>
            <VCHSTATUSDATE>${dateXml}</VCHSTATUSDATE>
            <GUID>${guid}</GUID>

            <STATENAME>${esc(partyState)}</STATENAME>
            <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
            <PARTYGSTIN>${esc(partyGstin)}</PARTYGSTIN>
            <PLACEOFSUPPLY>${esc(partyState)}</PLACEOFSUPPLY>

            <VOUCHERTYPENAME>${data.voucherType}</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME>
            <VOUCHERNUMBER>${esc(data.invoiceNumber)}</VOUCHERNUMBER>
            
            <REFERENCE>${esc(data.invoiceNumber)}</REFERENCE>
            <BASICBUYERNAME>${esc(buyerName)}</BASICBUYERNAME>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>Invoice No: ${esc(data.invoiceNumber)} | Date: ${esc(data.invoiceDate)} | Generated by AutoTally AI</NARRATION>

            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${esc(partyName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>${partyDeemedPos}</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>${partyAmountStr}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${esc(data.invoiceNumber)}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>${partyAmountStr}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </LEDGERENTRIES.LIST>

            ${inventoryXml}

            ${taxLedgersXml}

          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
};

export const pushToTally = async (xml: string): Promise<TallyResponse> => {
  try {
    console.log("-----------------------------------------");
    console.log("PUSHING XML TO:", TALLY_API_URL);
    console.log("XML CONTENT:", xml);
    console.log("-----------------------------------------");
    
    await fetch(TALLY_API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 
        'Content-Type': 'text/plain',
        'Connection': 'close' 
      },
      body: xml
    });

    return { success: true, message: "Payload sent to Tally (Blind Push). Check Tally Import logs." };
  } catch (error) {
    let msg = "Unknown Error";
    if (error instanceof Error) msg = error.message;
    console.error("PUSH FAILED:", msg);
    return { success: false, message: msg };
  }
};

export const fetchExistingLedgers = async (): Promise<Set<string>> => {
    const xml = `<ENVELOPE>
    <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
        <EXPORTDATA>
            <REQUESTDESC>
                <REPORTNAME>List of Accounts</REPORTNAME>
                <STATICVARIABLES>
                    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
                    <ACCOUNTTYPE>Ledgers</ACCOUNTTYPE> 
                </STATICVARIABLES>
            </REQUESTDESC>
        </EXPORTDATA>
    </BODY>
  </ENVELOPE>`;

  try {
      const response = await fetch(TALLY_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml' },
          body: xml
      });
      
      const text = await response.text();
      const ledgers = new Set<string>();
      
      const regexName = /<NAME>(.*?)<\/NAME>/gi;
      let match;
      while ((match = regexName.exec(text)) !== null) {
          const name = decodeHtml(match[1]);
          ledgers.add(name);
      }
      
      return ledgers;
  } catch (error) {
      console.warn("Could not fetch existing ledgers (likely CORS). Defaulting to Create All mode.", error);
      return new Set();
  }
};

export const fetchOpenCompanies = async (): Promise<string[]> => {
  const xml = `<ENVELOPE>
    <HEADER>
      <TALLYREQUEST>Export Data</TALLYREQUEST>
    </HEADER>
    <BODY>
      <EXPORTDATA>
        <REQUESTDESC>
          <REPORTNAME>List of Companies</REPORTNAME>
          <STATICVARIABLES>
            <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          </STATICVARIABLES>
        </REQUESTDESC>
      </EXPORTDATA>
    </BODY>
  </ENVELOPE>`;

  try {
    const response = await fetch(TALLY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: xml
    });

    const text = await response.text();
    const names: string[] = [];
    const regex = /<COMPANYNAME[^>]*>(.*?)<\/COMPANYNAME>/gi; 
    let match;
    while ((match = regex.exec(text)) !== null) {
        const name = decodeHtml(match[1]);
        if(name) names.push(name);
    }

    if (names.length === 0) {
        const regexDsp = /<DSPNAME[^>]*>(.*?)<\/DSPNAME>/gi;
        while ((match = regexDsp.exec(text)) !== null) {
             const name = decodeHtml(match[1]);
             if(name && !name.includes("List of Companies")) names.push(name);
        }
    }

    return [...new Set(names)].sort();
  } catch (error) {
    console.warn("Could not fetch companies (CORS or Network Error):", error);
    return [];
  }
};

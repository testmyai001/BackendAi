
import { InvoiceData, TallyResponse, BankStatementData, ExcelVoucher } from '../types';
import { TALLY_API_URL } from '../constants';
import { v4 as uuidv4 } from 'uuid';

/**
 * Tally Service - Frontend side
 * 
 * This service now handles:
 * - Local XML generation for preview/validation
 * - API calls to backend (NOT direct Tally calls)
 * - Data transformation from Excel to Tally format
 * 
 * All Tally communication goes through: POST http://localhost:8000/tally/excel/import
 * NOT direct to http://localhost:9000 (that would fail with CORS/Connection errors)
 */

const BACKEND_URL = 'http://localhost:8000';

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
     const timeoutId = setTimeout(() => controller.abort(), 3000);
     
     // Suppress console errors during connection check
     const originalError = console.error;
     console.error = () => {};
     
     try {
       await fetch(TALLY_API_URL, {
         method: 'GET',
         mode: 'no-cors', 
         signal: controller.signal
       });
       clearTimeout(timeoutId);
       console.error = originalError;
       return { online: true, info: "Port Is Open (Connected)", mode: 'blind' };
     } catch (fetchError) {
       clearTimeout(timeoutId);
       console.error = originalError;
       return { online: false, info: "Tally Not Available", mode: 'none' };
     }
  } catch (e) {
     console.error = console.error; // Restore if somehow overwritten
     return { online: false, info: "Tally Not Available", mode: 'none' };
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

// ============= EXCEL IMPORT - NOW USES BACKEND API =============

/**
 * Check if Tally is connected via backend
 */
export const checkTallyConnectionForExcel = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BACKEND_URL}/tally/excel/status`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.connected === true;
  } catch (error) {
    console.warn('Could not check Tally connection:', error);
    return false;
  }
};

/**
 * Fetch existing ledgers from Tally via backend
 * This is now server-side, so no CORS issues
 */
export const fetchExistingLedgersForExcel = async (): Promise<Set<string>> => {
  try {
    const response = await fetch(`${BACKEND_URL}/tally/excel/ledgers`);
    if (!response.ok) {
      console.warn('Failed to fetch ledgers, will create all masters');
      return new Set();
    }
    
    const data = await response.json();
    const ledgers = data.ledgers || [];
    console.log(`Fetched ${ledgers.length} existing ledgers from Tally`);
    return new Set(ledgers);
  } catch (error) {
    console.warn('Could not fetch existing ledgers (backend error):', error);
    return new Set();
  }
};

/**
 * Push Excel vouchers to Tally via backend API
 * This is the main function that sends data to backend for processing
 */
export const pushExcelVouchersToTally = async (
  vouchers: ExcelVoucher[],
  companyName?: string
): Promise<{
  success: boolean;
  message: string;
  createdCount?: number;
  errorCount?: number;
}> => {
  try {
    if (!vouchers.length) {
      return { success: false, message: 'No vouchers to import' };
    }

    // Validate voucher data before sending
    for (let i = 0; i < vouchers.length; i++) {
      const v = vouchers[i];
      if (!v.date || !v.invoiceNo || !v.partyName) {
        return { 
          success: false, 
          message: `Voucher ${i + 1}: Missing required fields (date, invoiceNo, partyName)` 
        };
      }
      if (!v.items || v.items.length === 0) {
        return { 
          success: false, 
          message: `Voucher ${i + 1} (${v.invoiceNo}): No items to import` 
        };
      }
      
      // Validate items
      for (let j = 0; j < v.items.length; j++) {
        const item = v.items[j];
        if (typeof item.amount !== 'number' || item.amount < 0) {
          return { 
            success: false, 
            message: `Voucher ${i + 1} item ${j + 1}: Invalid amount` 
          };
        }
        if (typeof item.taxRate !== 'number' || item.taxRate < 0 || item.taxRate > 100) {
          return { 
            success: false, 
            message: `Voucher ${i + 1} item ${j + 1}: Invalid tax rate (must be 0-100)` 
          };
        }
      }
    }

    console.log(`Sending ${vouchers.length} vouchers to backend for Tally import`);

    const response = await fetch(`${BACKEND_URL}/tally/excel/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vouchers: vouchers,
        companyName: companyName || '##SVCurrentCompany'
      }),
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.detail || errorMsg;
      } catch (e) {
        // Failed to parse error response
      }
      
      return {
        success: false,
        message: errorMsg,
      };
    }

    const result = await response.json();
    console.log('Tally import result:', result);
    
    return {
      success: result.success === true,
      message: result.message || 'Import completed',
      createdCount: result.createdCount,
      errorCount: result.errorCount,
    };
  } catch (error) {
    console.error('Error pushing vouchers to backend:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

// --- EXCEL IMPORT SUPPORT ---

export const analyzeLedgerRequirements = (vouchers: ExcelVoucher[], existingLedgers: Set<string>): string[] => {
    const required = new Set<string>();
    const missing: string[] = [];

    vouchers.forEach(voucher => {
        const partyName = cleanName(voucher.partyName);
        if (partyName) required.add(partyName);

        const isSales = voucher.voucherType === 'Sales';
        const gstin = voucher.gstin ? voucher.gstin.trim().toUpperCase() : '';
        const sourceStateCode = '27';
        const destStateCode = gstin.substring(0, 2);
        const isInterState = (gstin.length >= 2 && destStateCode !== sourceStateCode);

        voucher.items.forEach(item => {
             const ledgerName = item.ledgerName || `${isSales ? 'Sale' : 'Purchase'} ${item.taxRate}%`;
             required.add(ledgerName);

             if (item.taxRate > 0) {
                 if (isInterState) {
                     const igstName = `${isSales ? 'Output' : 'Input'} IGST ${item.taxRate}%`;
                     required.add(igstName);
                 } else {
                     const half = item.taxRate / 2;
                     const cgstName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
                     const sgstName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
                     required.add(cgstName);
                     required.add(sgstName);
                 }
             }
        });
    });

    required.forEach(req => {
        if (!existingLedgers.has(req)) {
            missing.push(req);
        }
    });

    return missing.sort();
};

export const generateBulkExcelXml = (vouchers: ExcelVoucher[], existingLedgers: Set<string> = new Set()): string => {
    // Debug: Log input data
    console.log('=== EXCEL IMPORT DEBUG ===');
    console.log('Total vouchers:', vouchers.length);
    vouchers.forEach((v, idx) => {
        console.log(`Voucher ${idx}:`, {
            invoiceNo: v.invoiceNo,
            type: v.voucherType,
            partyName: v.partyName,
            gstin: v.gstin,
            items: v.items.length,
            itemDetails: v.items.map(i => ({ amount: i.amount, taxRate: i.taxRate }))
        });
    });
    
    let mastersXml = '';
    let vouchersXml = '';
    const createdMasters = new Set<string>();

    // Get company from settings
    const settingsJson = localStorage.getItem('autotally_ai_settings');
    const tallyCompanyName = settingsJson ? JSON.parse(settingsJson).tallyCompany : null;
    const svCompany = tallyCompanyName && tallyCompanyName.trim() ? esc(tallyCompanyName) : '##SVCurrentCompany';

    // 1. Create all required masters first
    vouchers.forEach(voucher => {
        const partyName = cleanName(voucher.partyName);
        const gstin = voucher.gstin ? String(voucher.gstin).trim().toUpperCase() : '';
        
        // Validate GSTIN format (should be 15 chars for valid Indian GSTIN)
        const validGstin = gstin.length === 15 ? gstin : '';
        
        // Create Party Ledger
        if (!existingLedgers.has(partyName) && !createdMasters.has(partyName)) {
            const state = validGstin ? getStateName(validGstin) : '';
            const group = voucher.voucherType === 'Sales' ? 'Sundry Debtors' : 'Sundry Creditors';
            
            mastersXml += `
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <LEDGER NAME="${esc(partyName)}" ACTION="Create">
                    <NAME.LIST><NAME>${esc(partyName)}</NAME></NAME.LIST>
                    <PARENT>${group}</PARENT>
                    <ISBILLWISEON>Yes</ISBILLWISEON>
                    <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                    ${validGstin ? `<PARTYGSTIN>${esc(validGstin)}</PARTYGSTIN>` : ''}
                    ${state ? `<STATENAME>${esc(state)}</STATENAME>` : ''}
                </LEDGER>
            </TALLYMESSAGE>`;
            createdMasters.add(partyName);
        }

        // Create Item and Tax Ledgers
        voucher.items.forEach(item => {
            const taxRate = item.taxRate || 0;
            const ledgerName = item.ledgerName || `${voucher.voucherType === 'Sales' ? 'Sale' : 'Purchase'} ${formatRate(taxRate)}%`;
            
            if (!existingLedgers.has(ledgerName) && !createdMasters.has(ledgerName)) {
                mastersXml += `
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
                        <NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST>
                        <PARENT>${voucher.voucherType === 'Sales' ? 'Sales Accounts' : 'Purchase Accounts'}</PARENT>
                        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                        <GSTRATE>${taxRate}</GSTRATE>
                    </LEDGER>
                </TALLYMESSAGE>`;
                createdMasters.add(ledgerName);
            }

            // Create Tax Ledgers
            if (taxRate > 0) {
                const gstin = voucher.gstin ? voucher.gstin.trim().toUpperCase() : '';
                const destState = gstin.substring(0, 2);
                const isInterState = (gstin.length >= 2 && destState !== '27');

                if (isInterState) {
                    const igstName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} IGST ${formatRate(taxRate)}%`;
                    if (!existingLedgers.has(igstName) && !createdMasters.has(igstName)) {
                        mastersXml += `
                        <TALLYMESSAGE xmlns:UDF="TallyUDF">
                            <LEDGER NAME="${esc(igstName)}" ACTION="Create">
                                <NAME.LIST><NAME>${esc(igstName)}</NAME></NAME.LIST>
                                <PARENT>Duties &amp; Taxes</PARENT>
                                <TAXTYPE>GST</TAXTYPE>
                                <GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>
                                <GSTRATE>${taxRate}</GSTRATE>
                            </LEDGER>
                        </TALLYMESSAGE>`;
                        createdMasters.add(igstName);
                    }
                } else {
                    const half = taxRate / 2;
                    const cgstName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
                    const sgstName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;

                    [cgstName, sgstName].forEach((taxName, idx) => {
                        if (!existingLedgers.has(taxName) && !createdMasters.has(taxName)) {
                            const dutyHead = idx === 0 ? 'Central Tax' : 'State Tax';
                            mastersXml += `
                            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                                <LEDGER NAME="${esc(taxName)}" ACTION="Create">
                                    <NAME.LIST><NAME>${esc(taxName)}</NAME></NAME.LIST>
                                    <PARENT>Duties &amp; Taxes</PARENT>
                                    <TAXTYPE>GST</TAXTYPE>
                                    <GSTDUTYHEAD>${dutyHead}</GSTDUTYHEAD>
                                    <GSTRATE>${half}</GSTRATE>
                                </LEDGER>
                            </TALLYMESSAGE>`;
                            createdMasters.add(taxName);
                        }
                    });
                }
            }
        });
    });

    // 2. Create Vouchers with proper accounting entries
    vouchers.forEach((voucher, vIdx) => {
        const dateXml = formatDateForXml(voucher.date);
        const partyName = cleanName(voucher.partyName);
        const isSales = voucher.voucherType === 'Sales';
        const gstin = voucher.gstin ? String(voucher.gstin).trim().toUpperCase() : '';
        
        // Validate GSTIN: should be 15 chars, otherwise it's invalid data
        const validGstin = gstin.length === 15 ? gstin : '';
        const destState = validGstin ? validGstin.substring(0, 2) : '27';
        const isInterState = (validGstin.length === 15 && destState !== '27');

        let ledgerEntriesXml = '';
        let totalAmount = 0;
        const taxLedgerTotals: { [key: string]: number } = {};

        console.log(`Processing voucher ${vIdx}:`, {
            invoiceNo: voucher.invoiceNo,
            itemCount: voucher.items.length,
            gstin: voucher.gstin,
            validGstin: validGstin,
            isInterState: isInterState,
            items: voucher.items
        });

        // Calculate totals and track taxes
        voucher.items.forEach(item => {
            const amount = round(item.amount || 0);
            totalAmount += amount;
            
            const taxRate = item.taxRate || 0;
            if (taxRate > 0) {
                const taxAmount = round(amount * (taxRate / 100));
                
                if (isInterState) {
                    const taxName = `${isSales ? 'Output' : 'Input'} IGST ${formatRate(taxRate)}%`;
                    taxLedgerTotals[taxName] = (taxLedgerTotals[taxName] || 0) + taxAmount;
                } else {
                    const half = taxRate / 2;
                    const cgstName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
                    const sgstName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
                    const halfTax = round(taxAmount / 2);
                    taxLedgerTotals[cgstName] = (taxLedgerTotals[cgstName] || 0) + halfTax;
                    taxLedgerTotals[sgstName] = (taxLedgerTotals[sgstName] || 0) + (taxAmount - halfTax);
                }
            }
        });

        const finalTotal = round(totalAmount + Object.values(taxLedgerTotals).reduce((a, b) => a + b, 0));

        // Add Item Ledger Entries
        voucher.items.forEach(item => {
            const amount = round(item.amount || 0);
            const taxRate = item.taxRate || 0;
            const ledgerName = item.ledgerName || `${isSales ? 'Sale' : 'Purchase'} ${formatRate(taxRate)}%`;
            
            // Skip if amount is zero
            if (amount <= 0) {
                console.warn('Skipping item with zero amount:', item);
                return;
            }
            
            const amountStr = isSales ? `${amount.toFixed(2)}` : `-${amount.toFixed(2)}`;

            ledgerEntriesXml += `
            <LEDGERENTRIES.LIST>
                <LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>${isSales ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE>
                <AMOUNT>${amountStr}</AMOUNT>
            </LEDGERENTRIES.LIST>`;
        });

        // Add Tax Ledger Entries
        Object.entries(taxLedgerTotals).forEach(([name, amount]) => {
            const amt = round(amount);
            if (amt > 0) {
                const amountStr = isSales ? `${amt.toFixed(2)}` : `-${amt.toFixed(2)}`;
                ledgerEntriesXml += `
            <LEDGERENTRIES.LIST>
                <LEDGERNAME>${esc(name)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>${isSales ? 'No' : 'Yes'}</ISDEEMEDPOSITIVE>
                <AMOUNT>${amountStr}</AMOUNT>
            </LEDGERENTRIES.LIST>`;
            }
        });

        // Add Party Ledger Entry (balancing entry)
        const partyAmountStr = isSales ? `-${finalTotal.toFixed(2)}` : `${finalTotal.toFixed(2)}`;
        ledgerEntriesXml += `
        <LEDGERENTRIES.LIST>
            <LEDGERNAME>${esc(partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isSales ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
            <AMOUNT>${partyAmountStr}</AMOUNT>
            ${validGstin ? `<GSTINVOICENUMBER>${esc(voucher.invoiceNo)}</GSTINVOICENUMBER>` : ''}
        </LEDGERENTRIES.LIST>`;

        console.log(`Voucher ${voucher.invoiceNo} ledgerEntriesXml:`, {
            length: ledgerEntriesXml.length,
            hasContent: ledgerEntriesXml.trim().length > 0,
            itemCount: voucher.items.length,
            totalAmount,
            finalTotal,
            preview: ledgerEntriesXml.substring(0, 200)
        });

        vouchersXml += `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <VOUCHER VCHTYPE="${isSales ? 'Sales' : 'Purchase'}" ACTION="Create">
                <DATE>${dateXml}</DATE>
                <REFERENCE>${esc(voucher.invoiceNo)}</REFERENCE>
                <NARRATION>Inv: ${esc(voucher.invoiceNo)} | Party: ${esc(partyName)}</NARRATION>
                <VOUCHERTYPENAME>${isSales ? 'Sales' : 'Purchase'}</VOUCHERTYPENAME>
                <VOUCHERNUMBER>${esc(voucher.invoiceNo)}</VOUCHERNUMBER>
                <ISINVOICE>Yes</ISINVOICE>
                ${ledgerEntriesXml}
            </VOUCHER>
        </TALLYMESSAGE>`;
    });

    const finalXml = `
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

    // Log first voucher structure to help debug
    if (vouchersXml.length > 0) {
        const firstVoucherMatch = vouchersXml.match(/<VOUCHER[^>]*>[\s\S]*?<\/VOUCHER>/);
        if (firstVoucherMatch) {
            console.log('FIRST VOUCHER STRUCTURE:', firstVoucherMatch[0].substring(0, 1000));
        }
    }

    return finalXml;
};


import { InvoiceData, TallyResponse, BankStatementData, ExcelVoucher } from '../types';
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

export const cleanName = (str: string): string => {
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

// --- ANALYSIS HELPER ---
export const analyzeLedgerRequirements = (vouchers: ExcelVoucher[], existingLedgers: Set<string>): string[] => {
    const required = new Set<string>();
    const missing: string[] = [];

    vouchers.forEach(voucher => {
        // 1. Party Ledger
        const partyName = cleanName(voucher.partyName);
        if (partyName) required.add(partyName);

        const isSales = voucher.voucherType === 'Sales';
        
        // Check State for Tax Logic
        const gstin = voucher.gstin ? voucher.gstin.trim().toUpperCase() : '';
        const sourceStateCode = '27'; // Default Home State
        const destStateCode = gstin.substring(0, 2);
        // Determine Inter-state
        const isInterState = (gstin.length >= 2 && destStateCode !== sourceStateCode);

        voucher.items.forEach(item => {
             // 2. Purchase/Sales Ledger
             const ledgerName = item.ledgerName || `${isSales ? 'Sale' : 'Purchase'} ${item.taxRate}%`;
             required.add(ledgerName);

             // 3. Tax Ledgers
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

// --- CONNECTION CHECK ---
export const checkTallyConnection = async (): Promise<{ online: boolean; info: string; mode: 'full' | 'blind' | 'none'; activeCompany?: string }> => {
  try {
     const controller = new AbortController();
     const id = setTimeout(() => controller.abort(), 5000); 
     
     const response = await fetch(`${TALLY_API_URL}/health`, {
         method: 'GET',
         signal: controller.signal
     });
     clearTimeout(id);
     
     if (response.ok) {
         return { online: true, info: "Proxy Connected", mode: 'full' };
     }
     
     return { online: true, info: "Port Open", mode: 'full' };

  } catch (e) {
     let msg = "Unreachable";
     if (e instanceof Error) msg = e.message;
     return { online: false, info: `Offline: ${msg}`, mode: 'none' };
  }
};

// --- BANK XML GENERATION ---
export const generateBankStatementXml = (data: BankStatementData, existingLedgers: Set<string> = new Set()): string => {
  const svCompany = '##SVCurrentCompany';
  const bankLedger = esc(data.bankName);
  
  let mastersXml = '';
  
  if (!existingLedgers.has(data.bankName)) {
      mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${bankLedger}" ACTION="Create">
        <NAME.LIST><NAME>${bankLedger}</NAME></NAME.LIST>
        <PARENT>Bank Accounts</PARENT>
        <ISBILLWISEON>No</ISBILLWISEON>
        <ISGSTAPPLICABLE>No</ISGSTAPPLICABLE>
      </LEDGER>
    </TALLYMESSAGE>`;
  }

  const uniqueContras = new Set<string>();
  data.transactions.forEach(t => {
      if(t.contraLedger) uniqueContras.add(t.contraLedger);
  });

  uniqueContras.forEach(ledgerName => {
      if (ledgerName !== data.bankName && !existingLedgers.has(ledgerName)) {
           mastersXml += `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
        <NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST>
        <PARENT>Suspense A/c</PARENT>
        <ISGSTAPPLICABLE>No</ISGSTAPPLICABLE>
      </LEDGER>
    </TALLYMESSAGE>`;
      }
  });

  let vouchersXml = '';

  data.transactions.forEach((txn) => {
    const dateXml = formatDateForXml(txn.date);
    const amount = txn.voucherType === 'Payment' ? txn.withdrawal : txn.deposit;
    const contraLedger = esc(txn.contraLedger);
    const narration = esc(txn.description);
    
    const isPayment = txn.voucherType === 'Payment';
    
    const bankDeemedPos = isPayment ? 'No' : 'Yes';
    const bankAmountSign = isPayment ? 1 : -1; 
    const bankAmountVal = (amount * bankAmountSign).toFixed(2);

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
        
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${bankLedger}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${bankDeemedPos}</ISDEEMEDPOSITIVE>
          <AMOUNT>${bankAmountVal}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>

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
      <REQUESTDATA>${mastersXml}</REQUESTDATA>
    </IMPORTDATA>

    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${vouchersXml}</REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
};

// --- BULK EXCEL XML GENERATION ---
export const generateBulkExcelXml = (vouchers: ExcelVoucher[], existingLedgers: Set<string> = new Set()): string => {
    let mastersXml = '';
    let vouchersXml = '';
    const svCompany = '##SVCurrentCompany';
    const createdMasters = new Set<string>();

    // 1. Process Masters
    vouchers.forEach(voucher => {
        const partyName = cleanName(voucher.partyName);
        if (!existingLedgers.has(partyName) && !createdMasters.has(partyName)) {
            const group = 'Sundry Creditors'; 
            const state = getStateName(voucher.gstin);
            
            mastersXml += `
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
                <LEDGER NAME="${esc(partyName)}" ACTION="Create">
                    <NAME.LIST><NAME>${esc(partyName)}</NAME></NAME.LIST>
                    <PARENT>${group}</PARENT>
                    <ISBILLWISEON>Yes</ISBILLWISEON>
                    <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                    ${voucher.gstin ? `<PARTYGSTIN>${esc(voucher.gstin)}</PARTYGSTIN>` : ''}
                    ${state ? `<STATENAME>${esc(state)}</STATENAME>` : ''}
                </LEDGER>
            </TALLYMESSAGE>`;
            createdMasters.add(partyName);
        }

        const gstin = voucher.gstin ? voucher.gstin.trim().toUpperCase() : '';
        const homeState = '27';
        const destState = gstin.substring(0, 2);
        const isInterState = (gstin.length >= 2 && destState !== homeState);

        voucher.items.forEach(item => {
             const ledgerName = item.ledgerName || `${voucher.voucherType === 'Sales' ? 'Sale' : 'Purchase'} ${item.taxRate}%`;
             if (!existingLedgers.has(ledgerName) && !createdMasters.has(ledgerName)) {
                mastersXml += `
                <TALLYMESSAGE xmlns:UDF="TallyUDF">
                    <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
                        <NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST>
                        <PARENT>${voucher.voucherType === 'Sales' ? 'Sales Accounts' : 'Purchase Accounts'}</PARENT>
                        <ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>
                        <GSTRATE>${item.taxRate}</GSTRATE>
                    </LEDGER>
                </TALLYMESSAGE>`;
                createdMasters.add(ledgerName);
             }

             if (item.taxRate > 0) {
                if (isInterState) {
                    const taxLedgerName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} IGST ${item.taxRate}%`;
                    if (!existingLedgers.has(taxLedgerName) && !createdMasters.has(taxLedgerName)) {
                        mastersXml += `
                        <TALLYMESSAGE xmlns:UDF="TallyUDF">
                        <LEDGER NAME="${esc(taxLedgerName)}" ACTION="Create">
                        <NAME.LIST><NAME>${esc(taxLedgerName)}</NAME></NAME.LIST>
                        <PARENT>Duties &amp; Taxes</PARENT>
                        <TAXTYPE>GST</TAXTYPE>
                        <GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>
                        <GSTRATE>${item.taxRate}</GSTRATE>
                        </LEDGER>
                        </TALLYMESSAGE>`;
                        createdMasters.add(taxLedgerName);
                    }
                } else {
                    const half = item.taxRate / 2;
                    const cgstName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
                    const sgstName = `${voucher.voucherType === 'Sales' ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;

                    if (!existingLedgers.has(cgstName) && !createdMasters.has(cgstName)) {
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
                        createdMasters.add(cgstName);
                    }
                    if (!existingLedgers.has(sgstName) && !createdMasters.has(sgstName)) {
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
                        createdMasters.add(sgstName);
                    }
                }
             }
        });
    });

    // 2. Process Vouchers
    vouchers.forEach(voucher => {
        const dateXml = formatDateForXml(voucher.date);
        const partyName = cleanName(voucher.partyName);
        const isSales = voucher.voucherType === 'Sales';
        
        const gstin = voucher.gstin ? voucher.gstin.trim().toUpperCase() : '';
        const homeState = '27';
        const destState = gstin.substring(0, 2);
        const isInterState = (gstin.length >= 2 && destState !== homeState);

        const partyDeemedPos = isSales ? 'Yes' : 'No'; 
        const taxDeemedPos = isSales ? 'No' : 'Yes';

        let allocationsXml = '';
        let totalVoucherAmount = 0;
        
        voucher.items.forEach(item => {
            const taxable = round(item.amount);
            const rate = item.taxRate;
            const taxAmt = round(taxable * (rate / 100));
            
            totalVoucherAmount += (taxable + taxAmt);
            
            const ledgerName = item.ledgerName || `${isSales ? 'Sale' : 'Purchase'} ${rate}%`;
            
            const taxableStr = isSales ? `${taxable.toFixed(2)}` : `-${taxable.toFixed(2)}`;
            const taxStr = isSales ? `${taxAmt.toFixed(2)}` : `-${taxAmt.toFixed(2)}`;

            allocationsXml += `
            <LEDGERENTRIES.LIST>
                <LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>${taxDeemedPos}</ISDEEMEDPOSITIVE>
                <AMOUNT>${taxableStr}</AMOUNT>
            </LEDGERENTRIES.LIST>`;

            if (rate > 0) {
                 if (isInterState) {
                     const taxLedgerName = `${isSales ? 'Output' : 'Input'} IGST ${rate}%`;
                     allocationsXml += `
                    <LEDGERENTRIES.LIST>
                        <LEDGERNAME>${esc(taxLedgerName)}</LEDGERNAME>
                        <ISDEEMEDPOSITIVE>${taxDeemedPos}</ISDEEMEDPOSITIVE>
                        <AMOUNT>${taxStr}</AMOUNT>
                    </LEDGERENTRIES.LIST>`;
                 } else {
                     const half = rate / 2;
                     const halfTax = round(taxAmt / 2);
                     const otherHalf = round(taxAmt - halfTax);
                     
                     const cgstName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
                     const sgstName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
                     
                     const cgstStr = isSales ? `${halfTax.toFixed(2)}` : `-${halfTax.toFixed(2)}`;
                     const sgstStr = isSales ? `${otherHalf.toFixed(2)}` : `-${otherHalf.toFixed(2)}`;

                     allocationsXml += `
                    <LEDGERENTRIES.LIST>
                        <LEDGERNAME>${esc(cgstName)}</LEDGERNAME>
                        <ISDEEMEDPOSITIVE>${taxDeemedPos}</ISDEEMEDPOSITIVE>
                        <AMOUNT>${cgstStr}</AMOUNT>
                    </LEDGERENTRIES.LIST>
                    <LEDGERENTRIES.LIST>
                        <LEDGERNAME>${esc(sgstName)}</LEDGERNAME>
                        <ISDEEMEDPOSITIVE>${taxDeemedPos}</ISDEEMEDPOSITIVE>
                        <AMOUNT>${sgstStr}</AMOUNT>
                    </LEDGERENTRIES.LIST>`;
                 }
            }
        });

        const partyTotal = round(totalVoucherAmount);
        const partyAmountStr = isSales ? `-${partyTotal.toFixed(2)}` : `${partyTotal.toFixed(2)}`;
        
        vouchersXml += `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <VOUCHER VCHTYPE="${voucher.voucherType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
                <DATE>${dateXml}</DATE>
                <EFFECTIVEDATE>${dateXml}</EFFECTIVEDATE>
                <NARRATION>Imported from Excel. Ref: ${esc(voucher.invoiceNo)}</NARRATION>
                <VOUCHERTYPENAME>${voucher.voucherType}</VOUCHERTYPENAME>
                <VOUCHERNUMBER>${esc(voucher.invoiceNo)}</VOUCHERNUMBER>
                <REFERENCE>${esc(voucher.invoiceNo)}</REFERENCE>
                <PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME>
                <ISINVOICE>Yes</ISINVOICE>
                <GUID>${uuidv4()}</GUID>
                <FBTPAYMENTTYPE>Default</FBTPAYMENTTYPE>
                <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
                
                <ALLLEDGERENTRIES.LIST>
                    <LEDGERNAME>${esc(partyName)}</LEDGERNAME>
                    <ISDEEMEDPOSITIVE>${partyDeemedPos}</ISDEEMEDPOSITIVE>
                    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
                    <AMOUNT>${partyAmountStr}</AMOUNT>
                    <BILLALLOCATIONS.LIST>
                        <NAME>${esc(voucher.invoiceNo)}</NAME>
                        <BILLTYPE>New Ref</BILLTYPE>
                        <AMOUNT>${partyAmountStr}</AMOUNT>
                    </BILLALLOCATIONS.LIST>
                </ALLLEDGERENTRIES.LIST>

                ${allocationsXml}

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
          <REQUESTDATA>${mastersXml}</REQUESTDATA>
        </IMPORTDATA>
    
        <IMPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>Vouchers</REPORTNAME>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY>
            </STATICVARIABLES>
          </REQUESTDESC>
          <REQUESTDATA>${vouchersXml}</REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>`;
};

// --- INVOICE XML GENERATION ---
export const generateTallyXml = (data: InvoiceData, existingLedgers: Set<string> = new Set()): string => {
  const isSales = data.voucherType === 'Sales';
  const dateXml = formatDateForXml(data.invoiceDate); 
  const guid = uuidv4();
  const remoteId = uuidv4();
  const vchKey = `${uuidv4()}:00000008`;

  const svCompany = data.targetCompany && data.targetCompany.trim() ? esc(data.targetCompany) : '##SVCurrentCompany';
  const rawPartyName = (isSales ? data.buyerName : data.supplierName) || "Cash Party";
  const partyName = cleanName(rawPartyName);
  const partyGroup = isSales ? 'Sundry Debtors' : 'Sundry Creditors';
  const ledgerParentGroup = isSales ? 'Sales Accounts' : 'Purchase Accounts';
  const supplierGstin = (data.supplierGstin || '').trim().toUpperCase();
  const buyerGstin = (data.buyerGstin || '').trim().toUpperCase();
  const partyGstin = isSales ? buyerGstin : supplierGstin;
  const partyState = getStateName(partyGstin) || 'Maharashtra';
  const buyerName = data.buyerName || 'Cash Buyer';

  const sState = supplierGstin.substring(0, 2);
  const bState = buyerGstin.substring(0, 2);
  const isInterState = (sState && bState && sState !== bState);

  const partyDeemedPos = isSales ? 'Yes' : 'No';
  const itemDeemedPos = isSales ? 'No' : 'Yes';
  const itemSign = isSales ? 1 : -1;
  const taxLedgerTotals: Record<string, number> = {};
  let totalVoucherValue = 0; 

  let mastersXml = `
    <TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="Nos" ACTION="Create"><NAME>Nos</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT></UNIT></TALLYMESSAGE>
    <TALLYMESSAGE xmlns:UDF="TallyUDF"><GROUP NAME="${ledgerParentGroup}" ACTION="Create"><NAME.LIST><NAME>${ledgerParentGroup}</NAME></NAME.LIST><PARENT>Primary</PARENT></GROUP></TALLYMESSAGE>`;

  if (!existingLedgers.has(partyName)) {
    mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(partyName)}" ACTION="Create"><NAME.LIST><NAME>${esc(partyName)}</NAME></NAME.LIST><PARENT>${partyGroup}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE>${partyGstin ? `<PARTYGSTIN>${esc(partyGstin)}</PARTYGSTIN>` : ''}${partyState ? `<STATENAME>${esc(partyState)}</STATENAME>` : ''}</LEDGER></TALLYMESSAGE>`;
  }

  const uniqueRates = new Set<number>();
  data.lineItems.forEach(item => {
    const rate = Number(item.gstRate) || 0;
    uniqueRates.add(rate);
    const itemName = cleanName(item.description) || `Item @ ${rate}%`;
    mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="${esc(itemName)}" ACTION="Create"><NAME.LIST><NAME>${esc(itemName)}</NAME></NAME.LIST><PARENT>Primary</PARENT><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE>0 Nos</OPENINGBALANCE><ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE><GSTRATE>${rate}</GSTRATE></STOCKITEM></TALLYMESSAGE>`;
  });

  uniqueRates.forEach(rate => {
    const ledgerName = `${isSales ? 'Sale' : 'Purchase'} ${formatRate(rate)}%`;
    if (!existingLedgers.has(ledgerName)) {
        mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(ledgerName)}" ACTION="Create"><NAME.LIST><NAME>${esc(ledgerName)}</NAME></NAME.LIST><PARENT>${ledgerParentGroup}</PARENT><ISGSTAPPLICABLE>Yes</ISGSTAPPLICABLE><GSTRATE>${rate}</GSTRATE></LEDGER></TALLYMESSAGE>`;
    }
    if (isInterState) {
        const igstName = `${isSales ? 'Output' : 'Input'} IGST ${formatRate(rate)}%`;
        if (!existingLedgers.has(igstName)) {
            mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(igstName)}" ACTION="Create"><NAME.LIST><NAME>${esc(igstName)}</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD><GSTRATE>${rate}</GSTRATE></LEDGER></TALLYMESSAGE>`;
        }
    } else {
        const half = rate / 2;
        const cgstName = `${isSales ? 'Output' : 'Input'} CGST ${formatRate(half)}%`;
        const sgstName = `${isSales ? 'Output' : 'Input'} SGST ${formatRate(half)}%`;
        if (!existingLedgers.has(cgstName)) mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(cgstName)}" ACTION="Create"><NAME.LIST><NAME>${esc(cgstName)}</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Central Tax</GSTDUTYHEAD><GSTRATE>${half}</GSTRATE></LEDGER></TALLYMESSAGE>`;
        if (!existingLedgers.has(sgstName)) mastersXml += `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(sgstName)}" ACTION="Create"><NAME.LIST><NAME>${esc(sgstName)}</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>State Tax</GSTDUTYHEAD><GSTRATE>${half}</GSTRATE></LEDGER></TALLYMESSAGE>`;
    }
  });

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
    const amountStr = `${(amount * itemSign).toFixed(2)}`;
    inventoryXml += `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE><ACTUALQTY> ${qty} Nos</ACTUALQTY><BILLEDQTY> ${qty} Nos</BILLEDQTY><RATE>${itemRate.toFixed(2)}/Nos</RATE><AMOUNT>${amountStr}</AMOUNT><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(ledgerName)}</LEDGERNAME><ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE><AMOUNT>${amountStr}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
  });

  let taxLedgersXml = '';
  Object.entries(taxLedgerTotals).forEach(([name, rawAmt]) => {
      const amt = round(rawAmt);
      if (amt > 0) {
        const taxAmtStr = `${(amt * itemSign).toFixed(2)}`; 
        taxLedgersXml += `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${itemDeemedPos}</ISDEEMEDPOSITIVE><AMOUNT>${taxAmtStr}</AMOUNT></LEDGERENTRIES.LIST>`;
      }
  });

  const partySign = isSales ? -1 : 1; 
  const finalPartyTotal = round(totalVoucherValue);
  const partyAmountStr = `${(finalPartyTotal * partySign).toFixed(2)}`;

  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${mastersXml}</REQUESTDATA></IMPORTDATA><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${svCompany}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="${remoteId}" VCHKEY="${vchKey}" VCHTYPE="${data.voucherType}" ACTION="Create" OBJVIEW="Invoice Voucher View"><OLDAUDITENTRYIDS.LIST TYPE="Number"><OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS></OLDAUDITENTRYIDS.LIST><DATE>${dateXml}</DATE><EFFECTIVEDATE>${dateXml}</EFFECTIVEDATE><REFERENCEDATE>${dateXml}</REFERENCEDATE><VCHSTATUSDATE>${dateXml}</VCHSTATUSDATE><GUID>${guid}</GUID><STATENAME>${esc(partyState)}</STATENAME><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE><PARTYGSTIN>${esc(partyGstin)}</PARTYGSTIN><PLACEOFSUPPLY>${esc(partyState)}</PLACEOFSUPPLY><VOUCHERTYPENAME>${data.voucherType}</VOUCHERTYPENAME><PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME><VOUCHERNUMBER>${esc(data.invoiceNumber)}</VOUCHERNUMBER><REFERENCE>${esc(data.invoiceNumber)}</REFERENCE><BASICBUYERNAME>${esc(buyerName)}</BASICBUYERNAME><ISINVOICE>Yes</ISINVOICE><NARRATION>Invoice No: ${esc(data.invoiceNumber)} | Date: ${esc(data.invoiceDate)} | Generated by AutoTally AI</NARRATION><LEDGERENTRIES.LIST><LEDGERNAME>${esc(partyName)}</LEDGERNAME><ISDEEMEDPOSITIVE>${partyDeemedPos}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${partyAmountStr}</AMOUNT><BILLALLOCATIONS.LIST><NAME>${esc(data.invoiceNumber)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>${partyAmountStr}</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>${inventoryXml}${taxLedgersXml}</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
};

// --- PUSH FUNCTION ---
export const pushToTally = async (xml: string): Promise<TallyResponse> => {
  try {
    const response = await fetch(TALLY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Connection': 'close' },
      body: xml
    });
    const text = await response.text();
    if (text.includes("<LINEERROR>")) {
        const match = text.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
        return { success: false, message: `Tally Error: ${match ? match[1] : "Unknown"}` };
    }
    const errorsMatch = text.match(/<ERRORS>(\d+)<\/ERRORS>/);
    const errors = errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
    if (errors > 0) return { success: false, message: `Tally reported ${errors} errors.` };
    return { success: true, message: "Success" };
  } catch (error) {
    let msg = "Unknown Error";
    if (error instanceof Error) msg = error.message;
    return { success: false, message: `Network Error: ${msg}` };
  }
};

// --- FETCH LEDGERS ---
export const fetchExistingLedgers = async (): Promise<Set<string>> => {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><ACCOUNTTYPE>Ledgers</ACCOUNTTYPE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
      const response = await fetch(TALLY_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xml });
      const text = await response.text();
      const ledgers = new Set<string>();
      const regexName = /<NAME>(.*?)<\/NAME>/gi;
      let match;
      while ((match = regexName.exec(text)) !== null) {
          ledgers.add(decodeHtml(match[1]));
      }
      return ledgers;
  } catch (error) {
      console.warn("Could not fetch existing ledgers", error);
      return new Set();
  }
};

export const fetchOpenCompanies = async (): Promise<string[]> => {
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    const response = await fetch(TALLY_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: xml });
    const text = await response.text();
    const names: string[] = [];
    const regex = /<COMPANYNAME[^>]*>(.*?)<\/COMPANYNAME>/gi; 
    let match;
    while ((match = regex.exec(text)) !== null) {
        const name = decodeHtml(match[1]);
        if(name) names.push(name);
    }
    return [...new Set(names)].sort();
  } catch (error) { return []; }
};

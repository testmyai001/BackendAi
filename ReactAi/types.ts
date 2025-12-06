
export interface LineItem {
  id: string;
  description: string;
  hsn: string;
  quantity: number;
  rate: number;
  amount: number; // Taxable Value
  gstRate: number; // e.g., 18
  cgst?: number; // Calculated by backend
  sgst?: number; // Calculated by backend
  unit?: string; // e.g., Nos, Kg, Box
}

export interface InvoiceData {
  documentType: string; // allow INVOICE, BANK_STATEMENT, INVALID
  supplierName: string;
  supplierGstin: string;
  buyerName: string;
  buyerGstin: string;
  invoiceNumber: string;
  invoiceDate: string;

  // allow "Purchase" | "Sales" | dynamic
  voucherType: string;

  targetCompany: string;

  lineItems: Array<{
    id: string;
    description: string;
    hsn: string;
    quantity: number;
    rate: number;
    amount: number;
    gstRate: number;
    cgst?: number;
    sgst?: number;
    unit?: string;
  }>;
}


export interface BankTransaction {
  id: string;
  date: string;
  description: string;       // Narration field
  type: "Receipt" | "Payment" | "Contra" | string; // Transaction type

  // Debit / Credit amounts as required by UI
  debit: number;    // withdrawal amount (money out)
  credit: number;   // deposit amount (money in)

  voucherType: "Payment" | "Receipt" | "Contra" | string;
  contraLedger: string;      // Expense/Party ledger
}


export interface BankStatementData {
  documentType?: 'INVOICE' | 'BANK_STATEMENT'; // Classification flag
  bankName: string; // My Bank Ledger Name in Tally
  transactions: BankTransaction[];
  totalDeposits?: number;   // Total credits
  totalWithdrawals?: number; // Total debits
}

export interface ProcessedFile {
  id: string;
  file: File;
  status: 'Pending' | 'Processing' | 'Ready' | 'Success' | 'Failed' | 'Mismatch';
  fileName: string;
  sourceType: 'OCR_INVOICE' | 'BANK_STATEMENT' | 'EXCEL_IMPORT';
  data?: InvoiceData;
  bankData?: BankStatementData;
  excelSummary?: { vouchers: number };
  error?: string;
  correctEntries: number;
  incorrectEntries: number;
  timeTaken: string;
  uploadTimestamp: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  method: 'POST' | 'GET';
  endpoint: string;
  status: 'Success' | 'Failed' | 'Pending';
  message: string;
  response?: string;
}

export interface TallyResponse {
  success: boolean;
  message: string;
}

export interface AISettings {
  apiKey: string;
  model: string;
  tallyCompany?: string;
}

export interface ExcelVoucherItem {
  amount: number;
  taxRate: number;
  ledgerName?: string;
  itemName?: string;
  quantity?: number;
  rate?: number;
}

export interface ExcelVoucher {
  id: string;
  date: string;
  invoiceNo: string;
  partyName: string;
  gstin: string;
  voucherType: 'Sales' | 'Purchase';
  items: ExcelVoucherItem[];
  totalAmount: number;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  UPLOAD = 'UPLOAD',
  EDITOR = 'EDITOR',
  LOGS = 'LOGS',
  CHAT = 'CHAT',
  IMAGE_ANALYSIS = 'IMAGE_ANALYSIS',
  BANK_STATEMENT = 'BANK_STATEMENT',
  EXCEL_IMPORT = 'EXCEL_IMPORT'
}

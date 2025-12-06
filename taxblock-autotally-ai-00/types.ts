
export interface LineItem {
  id: string;
  description: string;
  hsn: string;
  quantity: number;
  rate: number;
  amount: number; // Taxable Value
  gstRate: number; // e.g., 18
  unit?: string; // e.g., Nos, Kg, Box
}

export interface InvoiceData {
  documentType?: 'INVOICE' | 'BANK_STATEMENT'; // Classification flag
  supplierName: string;
  supplierGstin: string;
  buyerName: string;
  buyerGstin: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  voucherType: 'Sales' | 'Purchase';
  targetCompany?: string; // Target Tally Company for import
  lineItems: LineItem[];
}

export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  withdrawal: number; // Debit
  deposit: number; // Credit
  balance?: number;
  contraLedger: string; // The Tally Ledger to map to (e.g., "Electricity Exp" or "Customer X")
  voucherType: 'Payment' | 'Receipt' | 'Contra';
}

export interface ExcelTransaction {
  date: string;
  invoiceNo: string;
  partyName: string;
  gstin: string;
  amount: number;
  taxRate: number;
  voucherType: 'Sales' | 'Purchase';
  ledgerName?: string; // Optional override
}

export interface ExcelVoucherItem {
  amount: number;
  taxRate: number;
  ledgerName?: string;
}

export interface ExcelVoucher {
  id: string;
  date: string;
  invoiceNo: string;
  partyName: string;
  gstin: string;
  voucherType: 'Sales' | 'Purchase';
  items: ExcelVoucherItem[];
  totalAmount: number; // Auto-calculated
}

export interface BankStatementData {
  documentType?: 'INVOICE' | 'BANK_STATEMENT'; // Classification flag
  bankName: string; // My Bank Ledger Name in Tally
  transactions: BankTransaction[];
}

export interface ProcessedFile {
  id: string;
  file: File;
  status: 'Pending' | 'Processing' | 'Ready' | 'Success' | 'Failed' | 'Mismatch'; 
  fileName: string;
  sourceType: 'OCR_INVOICE' | 'BANK_STATEMENT' | 'EXCEL_IMPORT'; // NEW: Track source
  data?: InvoiceData;
  bankData?: BankStatementData; // NEW: Store Bank Data
  excelSummary?: { vouchers: number }; // NEW: Store Excel Stats
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

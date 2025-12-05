/**
 * Backend Service - All AI operations are handled by Python backend
 * React only sends requests and receives responses
 * No direct Gemini integration in React
 */

import { InvoiceData, BankTransaction } from "../types";
import { v4 as uuidv4 } from 'uuid';

// Backend URL - configure this based on your environment
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";

interface ChatMessage {
  message: string;
}

interface ChatResponse {
  text: string;
}

interface ProcessInvoiceResponse {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  supplierGstin: string;
  buyerName: string;
  buyerGstin: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
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

interface ProcessBankStatementResponse {
  documentType: 'BANK_STATEMENT' | 'INVOICE';
  bankName: string;
  totalWithdrawals?: number;
  totalDeposits?: number;
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    type: string;
    debit: number;
    credit: number;
    voucherType: string;
    contraLedger: string;
  }>;
}

/**
 * Process invoice: Upload → OCR → Parse with backend AI → Save to DB
 * Backend handles all AI processing, React gets structured data back
 * ✅ FIXED: Now properly maps buyerName, buyerGstin, supplierGstin, and gstRate from backend
 */
export const parseInvoiceWithGemini = async (
  file: File
): Promise<InvoiceData> => {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${BACKEND_URL}/process-invoice`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Backend invoice processing failed");
    }

    const data: ProcessInvoiceResponse = await response.json();

    console.log("✅ Backend Invoice Response:", {
      supplierName: data.supplierName,
      supplierGstin: data.supplierGstin,
      buyerName: data.buyerName,
      buyerGstin: data.buyerGstin,
      lineItems: data.lineItems.length,
    });

    // Transform backend response to frontend InvoiceData format
    return {
      documentType: 'INVOICE',
      supplierName: data.supplierName || "",
      supplierGstin: data.supplierGstin || "",
      buyerName: data.buyerName || "",
      buyerGstin: data.buyerGstin || "",
      invoiceNumber: data.invoiceNumber || "",
      invoiceDate: data.invoiceDate || new Date().toLocaleDateString('en-GB').replace(/\//g, '-'),
      voucherType: "Purchase",
      targetCompany: "",
      lineItems: data.lineItems.map((item) => ({
        id: item.id.toString(),
        description: item.description || "",
        hsn: item.hsn || "",
        quantity: item.quantity || 0,
        rate: item.rate || 0,
        amount: item.amount || 0,
        gstRate: item.gstRate || 18,
        cgst: item.cgst || 0,
        sgst: item.sgst || 0,
        unit: item.unit || "Nos",
      })),
    };
  } catch (error) {
    console.error("Invoice processing error:", error);
    throw error;
  }
};

/**
 * Process bank statement: Upload → OCR → Parse with backend AI → Save to DB
 * Backend handles all AI processing
 */
export const parseBankStatementWithGemini = async (
  file: File
): Promise<{
  documentType: 'INVOICE' | 'BANK_STATEMENT';
  bankName: string;
  totalWithdrawals?: number;
  totalDeposits?: number;
  transactions: BankTransaction[];
}> => {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${BACKEND_URL}/process-bank-statement`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Backend bank statement processing failed");
    }

    const data: ProcessBankStatementResponse = await response.json();

    console.log("✅ Bank Statement Response:", {
      bankName: data.bankName,
      totalWithdrawals: data.totalWithdrawals,
      totalDeposits: data.totalDeposits,
      transactionCount: data.transactions.length,
    });

    // Transform backend response to frontend format
    return {
      documentType: data.documentType,
      bankName: data.bankName || "",
      totalWithdrawals: data.totalWithdrawals || 0,
      totalDeposits: data.totalDeposits || 0,
      transactions: data.transactions.map((tx) => ({
        id: String(tx.id),
        date: tx.date || "",
        description: tx.description || "",
        type: tx.type || "Payment",
        debit: tx.debit || 0,
        credit: tx.credit || 0,
        withdrawal: parseFloat(String(tx.debit || 0)),
        deposit: parseFloat(String(tx.credit || 0)),
        voucherType: tx.voucherType || "Payment",
        contraLedger: tx.contraLedger || "Suspense A/c",
      })),
    };
  } catch (error) {
    console.error("Bank statement processing error:", error);
    throw error;
  }
};

/**
 * Chat endpoint - All conversation handled by backend
 * Backend maintains chat history in database
 */
export const createChatSession = () => {
  return {
    sendMessage: async (payload: ChatMessage): Promise<ChatResponse> => {
      try {
        const response = await fetch(`${BACKEND_URL}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || "Chat request failed");
        }

        const data: ChatResponse = await response.json();
        return data;
      } catch (error) {
        console.error("Chat error:", error);
        throw error;
      }
    },
  };
};

/**
 * Image analysis with custom prompt
 * Backend uses Gemini Vision API
 */
export const analyzeImageWithGemini = async (
  file: File,
  prompt: string
): Promise<string> => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prompt", prompt || "Analyze this document.");

    const response = await fetch(`${BACKEND_URL}/analyze-image`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Image analysis failed");
    }

    const data = await response.json();
    return data.text || "No analysis returned.";
  } catch (error) {
    console.error("Image analysis error:", error);
    throw error;
  }
};

/**
 * Health check - verify backend is running
 */
export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BACKEND_URL}/`, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    console.error("Backend health check failed:", error);
    return false;
  }
};

/**
 * Get backend status
 */
export const getBackendStatus = async (): Promise<string> => {
  try {
    const response = await fetch(`${BACKEND_URL}/`, {
      method: "GET",
    });
    if (response.ok) {
      return "Backend is running";
    }
    return "Backend is not responding";
  } catch (error) {
    return `Backend error: ${error}`;
  }
};

/**
 * Calculate invoice totals - Real-time validation
 * Called when user edits line items
 */
export const calculateTotals = async (lineItems: Array<{amount: number; gstRate: number}>) => {
  try {
    const response = await fetch(`${BACKEND_URL}/calculate-totals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lineItems }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Calculation failed");
    }

    return await response.json();
  } catch (error) {
    console.error("Calculate totals error:", error);
    throw error;
  }
};
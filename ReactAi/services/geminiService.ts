import { GoogleGenAI, Type } from "@google/genai";
import { InvoiceData, BankTransaction } from "../types";
import { v4 as uuidv4 } from 'uuid';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PDFLib: any;
  }
}

export type ChatSession = any;

export const getAISettings = () => {
  return {
    apiKey: process.env.API_KEY || '',
    model: 'gemini-2.5-flash'
  };
};

const SYSTEM_INSTRUCTION = `
You are an expert Indian GST Invoice Accountant.
Extract data for Tally Prime XML integration.

CRITICAL DOCUMENT TYPE CHECK:
1. INVALID CHECK: Look at the image. If it is a photo of a person (selfie), animal, food, scenery, or a random object (sticker, car, etc.) and NOT a document, set 'documentType' to 'INVALID'.
2. BANK STATEMENT CHECK: If it contains columns like "Date", "Description/Narration", "Withdrawal/Debit", "Deposit/Credit", "Balance" AND DOES NOT contain "GSTIN" or "Tax Invoice", set 'documentType' to 'BANK_STATEMENT'.
3. INVOICE CHECK: If it is a Bill, Receipt, or Invoice (even if handwritten, simple, or missing specific fields), set 'documentType' to 'INVOICE'.

MISSING FIELDS POLICY:
- If fields like 'Supplier Name', 'Buyer Name', 'GSTIN', or 'Invoice Number' are missing, IT IS STILL A VALID INVOICE.
- Return empty strings for these fields. Do NOT mark as INVALID.
- Extract whatever data is available.

RULES FOR INVOICE EXTRACTION:
1. STOCK ITEM NAMES: STRICT LIMIT 25 CHARACTERS. Keep it short.
2. DATES: Standardize to DD-MM-YYYY.
3. GST: Infer rate (5, 12, 18, 28) from tax amounts.
4. NAMES: Extract the COMMON TRADE NAME (e.g., "Ruby Hall Clinic") instead of full legal names. Remove city names, legal prefixes, and "M/s".
Goal: Return a clean JSON object.
`;

const BANK_SYSTEM_INSTRUCTION = `
You are an expert Tally Prime Accountant. 
Analyze the Bank Statement image/PDF.

CRITICAL DOCUMENT TYPE CHECK:
- Look at the document structure.
- If it contains "GSTIN", "Invoice Number", "Taxable Value", "CGST/SGST/IGST" columns, IT IS A TAX INVOICE.
- If it is a Tax Invoice, set the field 'documentType' to 'INVOICE'.
- If it is a valid Bank Statement, set 'documentType' to 'BANK_STATEMENT'.

Extract each transaction row into JSON.
Also extract the BANK NAME from the document header.

RULES FOR BANK NAME & ACCOUNT NUMBER:
1.  **Identify Bank Name**: (e.g. HDFC, Kotak Mahindra, SBI).
2.  **Identify Account Number**: 
    - **CRITICAL PRIORITY**: You must distinguish between "Account No" and "CRN" or "Customer ID".
    - **IGNORE** numbers labeled "CRN", "CIF", "Customer ID", "User ID", or "IFSC".
    - **FIND** numbers labeled "Account No", "A/c No", "Ac No", "Acc No".
    - If you see "CRN: 123456" and "A/c No: ...8694", YOU MUST USE THE ACCOUNT NUMBER (8694).
3.  **Extract Last 4 Digits**: 
    - Identify the full Account Number (usually 10-15 digits).
    - Extract the *last 4 digits* of that confirmed Account Number.
4.  **Format**: Return 'bankName' as "Bank Name - XXXX". 
    - Example: If Bank is "Kotak" and Account is "XXXXXX8694", return "Kotak Mahindra Bank - 8694".
    - Do NOT return "Kotak Mahindra Bank - 4869" if 4869 is the CRN.

RULES FOR TRANSACTIONS:
1. DATE: Standardize to YYYY-MM-DD.
2. TYPE: If Withdrawal/Debit -> "Payment". If Deposit/Credit -> "Receipt".
3. LEDGER GUESSING: Based on narration, guess the Tally Ledger Name (e.g., "UPI/SWIGGY" -> "Staff Welfare", "NEFT/KOTAK" -> "Kotak Bank"). Default to "Suspense A/c".
4. NUMBERS: Ensure withdrawal and deposit are numbers. If a row has both, split or prioritize the non-zero.
`;

const extractPassword = (filename: string): string | null => {
  const match = filename.match(/Password-(.+?)\.pdf$/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
};

const getPdfBase64 = async (file: File): Promise<string> => {
  const password = extractPassword(file.name);
  
  if (password && file.type === 'application/pdf') {
    if (!window.PDFLib) {
      console.warn("PDFLib not loaded, skipping password handling. Please check internet connection.");
      return fileToBase64(file);
    }

    try {
      console.log(`Unlocking PDF: ${file.name} using password from filename.`);
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer, { password: password });
      const base64 = await pdfDoc.saveAsBase64();
      return base64;
    } catch (e) {
      console.error("Failed to unlock PDF. The password in the filename might be incorrect.", e);
      return fileToBase64(file);
    }
  }

  return fileToBase64(file);
};

export const parseInvoiceWithGemini = async (file: File): Promise<InvoiceData> => {
  const apiKey = process.env.API_KEY || process.env.REACT_APP_API_KEY;
  if (!apiKey) throw new Error("API Key is missing. Please set API_KEY or REACT_APP_API_KEY environment variable.");

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = await getPdfBase64(file);

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { inlineData: { mimeType: file.type, data: base64Data } },
        { text: "Extract invoice data for Tally." }
      ]
    },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING, enum: ['INVOICE', 'BANK_STATEMENT', 'INVALID'] },
          supplierName: { type: Type.STRING },
          supplierGstin: { type: Type.STRING },
          buyerName: { type: Type.STRING },
          buyerGstin: { type: Type.STRING },
          invoiceNumber: { type: Type.STRING },
          invoiceDate: { type: Type.STRING },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                hsn: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                rate: { type: Type.NUMBER },
                amount: { type: Type.NUMBER },
                gstRate: { type: Type.NUMBER }
              }
            }
          }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No data returned from Gemini");

  const data = JSON.parse(text);
  
  if (data.documentType === 'INVALID') {
    throw new Error("Invalid File");
  }

  if (data.documentType === 'BANK_STATEMENT') {
    return {
      documentType: 'BANK_STATEMENT',
      supplierName: '', supplierGstin: '', buyerName: '', buyerGstin: '',
      invoiceNumber: '', invoiceDate: '', voucherType: 'Purchase', targetCompany: '', lineItems: []
    };
  }

  const lineItems = (data.lineItems || []).map((item: any) => ({
    ...item,
    id: uuidv4(),
    gstRate: item.gstRate || 18,
    amount: item.amount || (item.quantity * item.rate)
  }));

  let dateDisplay = data.invoiceDate || new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateDisplay)) {
    const [y, m, d] = dateDisplay.split('-');
    dateDisplay = `${d}-${m}-${y}`;
  }

  return {
    documentType: 'INVOICE',
    supplierName: data.supplierName || "",
    supplierGstin: data.supplierGstin || "",
    buyerName: data.buyerName || "",
    buyerGstin: data.buyerGstin || "",
    invoiceNumber: data.invoiceNumber || "",
    invoiceDate: dateDisplay, 
    voucherType: "Purchase",
    targetCompany: "",
    lineItems: lineItems
  };
};

export const parseBankStatementWithGemini = async (file: File): Promise<{
  documentType: 'INVOICE' | 'BANK_STATEMENT'; 
  bankName: string; 
  transactions: BankTransaction[]
}> => {
  const apiKey = process.env.API_KEY || process.env.REACT_APP_API_KEY;
  if (!apiKey) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = await getPdfBase64(file);

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { inlineData: { mimeType: file.type, data: base64Data } },
        { text: "Extract bank transactions from this statement table and identify the bank name." }
      ]
    },
    config: {
      systemInstruction: BANK_SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING, enum: ['INVOICE', 'BANK_STATEMENT'] },
          bankName: { type: Type.STRING },
          transactions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                description: { type: Type.STRING },
                withdrawal: { type: Type.NUMBER },
                deposit: { type: Type.NUMBER },
                voucherType: { type: Type.STRING, enum: ['Payment', 'Receipt'] },
                suggestedLedger: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No data returned from Gemini");
  const rawData = JSON.parse(text);

  if (rawData.documentType === 'INVOICE') {
    return { documentType: 'INVOICE', bankName: '', transactions: [] };
  }

  const transactions = (rawData.transactions || []).map((item: any) => ({
    id: uuidv4(),
    date: item.date,
    description: item.description,
    withdrawal: item.withdrawal || 0,
    deposit: item.deposit || 0,
    voucherType: item.voucherType || (item.withdrawal > 0 ? 'Payment' : 'Receipt'),
    contraLedger: item.suggestedLedger || "Suspense A/c"
  }));

  return {
    documentType: 'BANK_STATEMENT',
    bankName: rawData.bankName || "",
    transactions
  };
};

export const createChatSession = () => {
  const apiKey = process.env.API_KEY || process.env.REACT_APP_API_KEY;
  if (!apiKey) throw new Error("API Key is missing");
  
  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: 'You are AutoTally Assistant, an expert in Tally Prime, GST compliance, and accounting automation. Help the user with their queries.',
    },
  });
};

export const analyzeImageWithGemini = async (file: File, prompt: string): Promise<string> => {
  const apiKey = process.env.API_KEY || process.env.REACT_APP_API_KEY;
  if (!apiKey) throw new Error("API Key is missing");

  const ai = new GoogleGenAI({ apiKey });
  const base64Data = await getPdfBase64(file);

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        { inlineData: { mimeType: file.type, data: base64Data } },
        { text: prompt || "Analyze this document." }
      ]
    }
  });

  return response.text || "No analysis returned.";
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

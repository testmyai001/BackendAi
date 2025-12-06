
import { InvoiceData } from './types';

// Points to the Python FastAPI Backend
export const TALLY_API_URL = "http://127.0.0.1:8000";

export const MOCK_INVOICE: InvoiceData = {
  supplierName: "Tech Solutions Pvt Ltd",
  supplierGstin: "27ABCDE1234F1Z5", 
  buyerName: "Global Traders Inc",
  buyerGstin: "27XYZAB5678C1Z2", 
  invoiceNumber: "INV-2024-001",
  invoiceDate: "01-08-2025", 
  voucherType: "Purchase",
  lineItems: [
    {
      id: "1",
      description: "Dell Latitude 7420 Laptop",
      hsn: "8471",
      quantity: 1,
      rate: 45000,
      amount: 45000,
      gstRate: 12,
      unit: "Nos"
    },
    {
      id: "2",
      description: "Logitech MX Master 3",
      hsn: "8471",
      quantity: 5,
      rate: 9000,
      amount: 45000,
      gstRate: 18,
      unit: "Nos"
    }
  ]
};

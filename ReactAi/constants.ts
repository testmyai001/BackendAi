import { InvoiceData } from './types';

// Tally Prime Connection
// Use local port 9000 for direct connection to Tally
// For remote access, set up Ngrok tunnel and update this URL
export const TALLY_API_URL = process.env.REACT_APP_TALLY_URL || "http://localhost:9000";

export const MOCK_INVOICE: InvoiceData = {
  documentType: "INVOICE",
  supplierName: "Tech Solutions Pvt Ltd",
  supplierGstin: "27ABCDE1234F1Z5", 
  buyerName: "Global Traders Inc",
  buyerGstin: "27XYZAB5678C1Z2", 
  invoiceNumber: "INV-2024-001",
  // CHANGED TO 1st of Month for Tally EDU Compatibility
  invoiceDate: "01-08-2025", 
  voucherType: "Purchase",
  targetCompany: "Demo Company",
  lineItems: [
    {
      id: "1",
      description: "Dell Latitude 7420 Laptop",
      hsn: "8471",
      quantity: 1,
      rate: 45000,
      amount: 45000,
      gstRate: 12 
    },
    {
      id: "2",
      description: "Logitech MX Master 3",
      hsn: "8471",
      quantity: 5,
      rate: 9000,
      amount: 45000,
      gstRate: 18
    }
  ]
};
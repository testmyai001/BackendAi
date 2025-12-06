
import { InvoiceData, LogEntry } from '../types';
import { TALLY_API_URL } from '../constants';

export const saveLogToDB = async (log: LogEntry) => {
  try {
    await fetch(`${TALLY_API_URL}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(log)
    });
  } catch (error) {
    // console.warn("Failed to save log to DB (Backend offline?)");
  }
};

export const saveInvoiceToDB = async (data: InvoiceData, status: string, id: string) => {
  try {
    const payload = {
        id: id,
        invoice_number: data.invoiceNumber,
        party_name: data.voucherType === 'Sales' ? data.buyerName : data.supplierName,
        invoice_date: data.invoiceDate, 
        amount: data.lineItems.reduce((acc, item) => acc + (item.amount || 0), 0),
        voucher_type: data.voucherType,
        status: status,
        json_data: data
    };

    await fetch(`${TALLY_API_URL}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    // console.warn("Failed to save invoice to DB");
  }
};

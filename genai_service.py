# === FILE: /backend/genai_service.py ===
# type: ignore
import os
import json
import mimetypes
import time
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from functools import wraps


load_dotenv()


# This module uses google.generativeai Python SDK. Ensure the package is installed and configured.
# The user must place GOOGLE_API_KEY or set up application default credentials as required by Google SDK.


try:
    import google.generativeai as genai
    # Access public API classes (Pylance may complain but these are valid at runtime)
    GenerativeModel = genai.GenerativeModel  # type: ignore
    upload_file = genai.upload_file  # type: ignore
    configure = genai.configure  # type: ignore
except Exception:
    genai = None
    GenerativeModel = None
    upload_file = None
    configure = None

# ============================================================================
# OPTIMIZATION #5: GLOBAL CLIENT & MODEL REUSE (Initialize once at startup)
# ============================================================================

_genai_client = None
_genai_model = None
_bank_model = None
_uploaded_files = []  # Track uploaded files for cleanup

def initialize_genai():
    """Initialize Gemini client and models once at module load."""
    global _genai_client, _genai_model, _bank_model
    
    if _genai_client is not None:
        return  # Already initialized
    
    api_key = os.getenv('GOOGLE_API_KEY')
    if not api_key:
        raise RuntimeError('GOOGLE_API_KEY not configured in environment')
    
    if genai is None:
        raise RuntimeError('google.generativeai package not installed')
    
    # Configure API once
    configure(api_key=api_key)  # type: ignore
    _genai_client = genai
    
    # OPTIMIZATION #6: Compressed system instruction (12 lines instead of 25)
    # Removed: Verbose explanations, examples, formatting tips
    # Kept: Only critical extraction rules
    invoice_system_instruction = """Extract invoice data to JSON ONLY.

Return JSON with documentType (INVOICE|BANK_STATEMENT|INVALID) and fields:
invoiceNumber, invoiceDate (DD-MM-YYYY), supplierName, supplierGstin (15 chars),
buyerName (from Bill To), buyerGstin, lineItems array with description, hsn, quantity,
rate, amount, gstRate (5/12/18/28), unit. Extract raw data only. If NOT invoice, set
documentType to INVALID. Return ONLY JSON, no text."""
    
    bank_system_instruction = """Extract bank statement data to JSON ONLY.

Return JSON with documentType (BANK_STATEMENT|INVOICE), bankName, accountNumber,
accountNumberLast4, transactions array with transaction_date (YYYY-MM-DD),
description, withdrawal, deposit, balance, voucherType (Payment|Receipt),
suggestedLedger. If TAX INVOICE detected (GSTIN/HSN/CGST columns), set
documentType to INVOICE. Extract raw data only. Return ONLY JSON."""
    
    model_name = os.getenv('GENAI_MODEL', 'gemini-2.0-flash-exp')
    
    # Create model instance with compressed prompt - reuse for all invoice parsing
    _genai_model = GenerativeModel(  # type: ignore
        model_name,
        system_instruction=invoice_system_instruction,
        generation_config={
            "response_mime_type": "application/json",
            "temperature": 0.0,
            "max_output_tokens": 3000,
        }
    )
    
    # Bank statement model
    _bank_model = GenerativeModel(  # type: ignore
        model_name,
        system_instruction=bank_system_instruction,
        generation_config={
            "response_mime_type": "application/json",
            "temperature": 0.0,
            "max_output_tokens": 8000,
        }
    )

def get_genai_model():
    """Get or initialize Gemini model."""
    global _genai_model
    if _genai_model is None:
        initialize_genai()
    return _genai_model

def get_bank_model():
    """Get or initialize Bank statement model."""
    global _bank_model
    if _bank_model is None:
        initialize_genai()
    return _bank_model

# ============================================================================
# OPTIMIZATION #4: RETRY DECORATOR WITH EXPONENTIAL BACKOFF
# ============================================================================

def retry_with_backoff(max_attempts=3, base_delay=1):
    """Decorator for retrying failed API calls with exponential backoff."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        wait_time = base_delay * (2 ** attempt)  # 1s, 2s, 4s
                        print(f"Attempt {attempt + 1} failed: {str(e)[:100]}")
                        print(f"   Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        print(f"All {max_attempts} attempts failed")
            raise last_exception
        return wrapper
    return decorator


def format_amount(value: float) -> float:
    """Format amount to 2 decimal places."""
    try:
        return round(float(value), 2)
    except (ValueError, TypeError):
        return 0.00


def cleanup_uploaded_file(file_uri: Optional[str]) -> bool:
    """Delete a file from Gemini API storage"""
    if not file_uri or genai is None:
        return False
    try:
        # Extract file ID from URI (format: https://...../files/FILE_ID)
        file_id = file_uri.split('/')[-1] if '/' in file_uri else file_uri
        genai.delete_file(file_id)  # type: ignore
        if file_uri in _uploaded_files:
            _uploaded_files.remove(file_uri)
        print(f"Deleted Gemini file: {file_id}")
        return True
    except Exception as e:
        print(f"Failed to delete Gemini file: {e}")
        return False


PROMPT_TEMPLATE = """
You are a highly-accurate parser. Convert the following invoice text into JSON.

Output valid JSON ONLY with these exact fields:

{
  "invoiceNumber": "",
  "invoiceDate": "",
  "supplierName": "",
  "supplierGstin": "",
  "buyerName": "",
  "buyerGstin": "",
  "taxableValue": 0,
  "total": 0,
  "lineItems": [
    {
      "description": "",
      "hsn": "",
      "quantity": 0,
      "rate": 0,
      "amount": 0,
      "gstRate": 0,
      "unit": ""
    }
  ]
}

Rules:
- Extract buyerName from "Bill To", "Buyer", "Customer", "Ship To".
- Extract buyerGstin near that section.
- Format dates as DD-MM-YYYY.
- If missing, return empty string (not null).
- Do not calculate totals. Extract only raw invoice values.
- Return JSON only.
\nOCR_TEXT:\n"""

BANK_STATEMENT_PROMPT = """
You are a bank statement parser. Convert the following OCR text of a bank statement into JSON with these exact fields:
Output must be valid JSON only (no explanation).
Fields:
- bankName
- transactions: array of { transaction_date (DD-MM-YYYY), description, amount (float), balance (float) }
If a field is missing, set it to null or an empty array for transactions.
\nBANK_STATEMENT_TEXT:\n"""

IMAGE_ANALYSIS_PROMPT = """
Analyze the following image and provide a detailed analysis. Be concise and accurate.
User Prompt: {prompt}
\nProvide your analysis as plain text."""


def parse_invoice_with_gemini(file_path: str) -> Dict[str, Any]:
    """Parse invoice file (PDF/Image) directly using Google Gemini API with JSON schema."""
    text = ""
    api_key = os.getenv('GOOGLE_API_KEY')
    if genai is None:
        raise RuntimeError('google.generativeai package not installed')
    if not api_key:
        raise RuntimeError('GOOGLE_API_KEY not configured in environment')

    configure(api_key=api_key)  # type: ignore

    # Determine MIME type
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        if file_path.lower().endswith('.pdf'):
            mime_type = 'application/pdf'
        elif file_path.lower().endswith(('.jpg', '.jpeg')):
            mime_type = 'image/jpeg'
        elif file_path.lower().endswith('.png'):
            mime_type = 'image/png'
        else:
            raise ValueError(f'Unsupported file type: {file_path}')
    
    # Upload file to Gemini
    uploaded_file = None
    try:
        uploaded_file = upload_file(file_path, mime_type=mime_type)
        _uploaded_files.append(uploaded_file.uri)
        
        # System instruction - optimized for speed
        system_instruction = """
Extract invoice data to JSON ONLY. No calculations. No text.

CRITICAL EXTRACTION RULES:
1. BUYER DETAILS: Look for "Bill To", "Ship To", "Consignee", "Customer" sections and extract:
   - Buyer Name: The person/company name (NOT address)
   - Buyer GSTIN: The 15-character tax ID (NOT supplier GSTIN)
2. SUPPLIER DETAILS: Look for "Bill From", "Invoice From", "Seller", company letterhead and extract:
   - Supplier Name: The vendor/seller company name
   - Supplier GSTIN: The 15-character tax ID for seller
3. LINE ITEMS: Extract each row with description, HSN code, quantity, rate, amount, GST%
4. GST Rate valid values: 5, 12, 18, or 28 only
5. Document type: INVOICE, BANK_STATEMENT, or INVALID

Return ONLY JSON (no markdown, no text):
{
  "documentType": "INVOICE|BANK_STATEMENT|INVALID",
  "invoiceNumber": "invoice number string",
  "invoiceDate": "DD-MM-YYYY",
  "supplierName": "company/vendor name",
  "supplierGstin": "15 alphanumeric chars or empty",
  "buyerName": "customer/buyer name from Bill To section",
  "buyerGstin": "15 alphanumeric chars or empty",
  "lineItems": [
    {
      "description": "item description (max 30 chars)",
      "hsn": "HSN code",
      "quantity": number,
      "rate": number,
      "amount": number,
      "gstRate": number (5/12/18/28),
      "unit": "Nos or Kgs or Box or Bag or Ltr"
    }
  ],
  "taxableValue": number
}
"""
        
        model_name = os.getenv('GENAI_MODEL', 'gemini-2.0-flash-exp')
        model = GenerativeModel(  # type: ignore
            model_name,
            system_instruction=system_instruction,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.0,
                "max_output_tokens": 5000,
            }
        )
        
        response = model.generate_content(
            [
                uploaded_file,
                "Extract invoice data for Tally as JSON."
            ]
        )
        
        text = response.text
        
        # Safe parsing: extract JSON from response
        start = text.find('{')
        end = text.rfind('}')
        if start == -1 or end == -1:
            raise ValueError('Could not find JSON in model output')
        
        json_text = text[start:end+1]
        parsed = json.loads(json_text)
        
        # Transform to match backend expectations
        if parsed.get('documentType') == 'INVALID':
            return {'error': 'Invalid File'}
        
        if parsed.get('documentType') == 'BANK_STATEMENT':
            return {
                'documentType': 'BANK_STATEMENT',
                'error': 'Document is a bank statement, not an invoice'
            }
        
        # Extract line items - NO CALCULATION, just extract raw data
        line_items = []
        for item in parsed.get('lineItems', []):
            line_items.append({
                'hsn': str(item.get('hsn', '')).strip(),
                'description': str(item.get('description', '')).strip(),
                'qty': format_amount(item.get('quantity', 0)),
                'rate': format_amount(item.get('rate', 0)),
                'amount': format_amount(item.get('amount', 0)),
                'gst_rate': float(item.get('gstRate', 18)),
                'unit': str(item.get('unit', 'Nos')).strip()
            })
        
        # Calculate totals and tax split
        total_taxable = format_amount(sum(item['amount'] for item in line_items))
        
        # Calculate CGST/SGST for each line item (50/50 split)
        def round_strict(num):
            return round(num + 1e-9, 2)
        
        total_cgst = 0
        total_sgst = 0
        for item in line_items:
            gst_rate = item['gst_rate']
            cgst = round_strict(item['amount'] * (gst_rate / 2) / 100)
            sgst = round_strict(item['amount'] * (gst_rate / 2) / 100)
            item['cgst'] = format_amount(cgst)
            item['sgst'] = format_amount(sgst)
            total_cgst += cgst
            total_sgst += sgst
        
        total_cgst = format_amount(round_strict(total_cgst))
        total_sgst = format_amount(round_strict(total_sgst))
        total_gst = format_amount(round_strict(total_cgst + total_sgst))
        grand_total = format_amount(round_strict(total_taxable + total_gst))
        
        # Build response with buyer details
        buyer_name = str(parsed.get('buyerName', '')).strip()
        buyer_gstin = str(parsed.get('buyerGstin', '')).strip()
        supplier_gstin = str(parsed.get('supplierGstin', '')).strip()
        
        print(f"DEBUG - Full parsed JSON: {json.dumps(parsed, indent=2)}")
        print(f"DEBUG - Extracted buyer_name: '{buyer_name}'")
        print(f"DEBUG - Extracted buyer_gstin: '{buyer_gstin}'")
        print(f"DEBUG - Extracted supplier_gstin: '{supplier_gstin}'")
        print(f"DEBUG - Total Taxable: {total_taxable}, CGST: {total_cgst}, SGST: {total_sgst}, Grand: {grand_total}")
        
        return {
            'invoice_number': str(parsed.get('invoiceNumber', '')).strip(),
            'invoice_date': str(parsed.get('invoiceDate', '')).strip(),
            'supplier_name': str(parsed.get('supplierName', '')).strip(),
            'gstin': supplier_gstin,
            'buyer_name': buyer_name,
            'buyer_gstin': buyer_gstin,
            'taxable': total_taxable,
            'cgst': total_cgst,
            'sgst': total_sgst,
            'igst': 0,
            'total': grand_total,
            'line_items': line_items
        }
    except json.JSONDecodeError as e:
        print(f"DEBUG - JSON Decode Error: {str(e)}")
        print(f"DEBUG - Raw Response: {text[:500]}" if 'text' in locals() else "")
        return {'error': 'Failed to parse response as JSON', 'raw_response': text[:500] if 'text' in locals() else ''}
    finally:
        # Cleanup uploaded file
        if uploaded_file:
            cleanup_uploaded_file(uploaded_file.uri)


def parse_bank_statement_with_gemini(ocr_text: Optional[str] = None, file_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse bank statement using Google Gemini API with JSON schema.
    Can accept either OCR text or direct file path (PDF/Image).
    """
    text = ""
    api_key = os.getenv('GOOGLE_API_KEY')
    if genai is None:
        raise RuntimeError('google.generativeai package not installed')
    if not api_key:
        raise RuntimeError('GOOGLE_API_KEY not configured in environment')

    configure(api_key=api_key)  # type: ignore
    
    model_name = os.getenv('GENAI_MODEL', 'gemini-2.0-flash-exp')
    uploaded_file = None
    
    bank_system_instruction = """
You are an expert Tally Prime Accountant. 
Analyze the Bank Statement image/PDF.

CRITICAL DOCUMENT TYPE CHECK:
- Look at the document structure.
- If it contains "GSTIN", "Invoice Number", "Taxable Value", "CGST/SGST/IGST" columns, IT IS A TAX INVOICE.
- If it is a Tax Invoice, set the field 'documentType' to 'INVOICE'.
- If it is a valid Bank Statement, set 'documentType' to 'BANK_STATEMENT'.

Extract each transaction row into JSON.
Also extract the BANK NAME and ACCOUNT NUMBER from the document header.

RULES FOR BANK NAME & ACCOUNT NUMBER:
1. BANK NAME EXTRACTION:
   - Look for bank name in header, letterhead, or top section of document
   - Examples: "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "State Bank of India", "Yes Bank"
   - Extract the official bank name as it appears on the statement

2. ACCOUNT NUMBER EXTRACTION (CRITICAL):
   - Distinguish carefully between ACCOUNT NUMBER and other IDs:
     * ACCOUNT NO / Account Number / Acc No -> CORRECT (this is the account number)
     * CRN (Customer Reference Number) -> NOT account number
     * Customer ID / Customer Code -> NOT account number
     * IFSC Code / SWIFT Code -> NOT account number
     * Card Number -> NOT account number
   - The account number is typically 10-16 digits
   - If account number is not clearly labeled, look for a 10-16 digit number near the bank name or in "Account Details" section
   - Extract the LAST 4 DIGITS of the account number for display purposes

3. RETURN FORMAT FOR BANK NAME & ACCOUNT NUMBER:
   - bankName: Extract bank name as string (e.g., "Kotak Mahindra Bank")
   - accountNumber: Extract full account number (e.g., "1234567890123456")
   - accountNumberLast4: Extract last 4 digits only (e.g., "3456")
   - If account number not found, set accountNumber and accountNumberLast4 to empty strings or null
   - IMPORTANT: Return all three fields in the response JSON

RULES FOR TRANSACTIONS:
1. DATE: Standardize to YYYY-MM-DD.
2. TYPE: 
    - Withdrawal/Debit -> "Payment"
    - Deposit/Credit -> "Receipt"
3. LEDGER GUESSING (CRITICAL):
    - Analyze the 'Description'/'Narration' text to guess the Tally Ledger.
    - "Swiggy", "Zomato", "Pizza", "Mcdonalds" -> "Staff Welfare"
    - "Uber", "Ola", "Petrol", "Fuel" -> "Travelling Expenses"
    - "Electricity", "Power", "MSEB" -> "Electricity Charges"
    - "Rent" -> "Rent"
    - "Salary" -> "Salary Payable"
    - "Interest" -> "Bank Interest"
    - "Charges", "Fee" -> "Bank Charges"
    - "UPI", "PhonePe", "Paytm", "GPay" -> "UPI Suspense"
    - "NEFT", "RTGS", "IMPS" -> "Bank Transfers"
    - If unable to guess, default to "Suspense A/c".

4. NUMBERS: 
    - Extract strictly as POSITIVE numbers.
    - If a row says "500.00 (Dr)", put 500 in withdrawal.
    - If a row says "1000.00 (Cr)", put 1000 in deposit.

RETURN JSON FORMAT (EXACT):
{
  "documentType": "BANK_STATEMENT",
  "bankName": "string (e.g., 'Kotak Mahindra Bank')",
  "accountNumber": "string (e.g., '1234567890123456') or empty",
  "accountNumberLast4": "string (e.g., '3456') or empty",
  "transactions": [
    {
      "transaction_date": "YYYY-MM-DD",
      "description": "string",
      "withdrawal": 0,
      "deposit": 0,
      "balance": 0,
      "voucherType": "Payment or Receipt",
      "suggestedLedger": "string"
    }
  ]
}
"""
    
    try:
        if file_path:
            # Direct file upload
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File not found: {file_path}")
            
            # Determine MIME type
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                if file_path.lower().endswith('.pdf'):
                    mime_type = 'application/pdf'
                elif file_path.lower().endswith(('.jpg', '.jpeg')):
                    mime_type = 'image/jpeg'
                elif file_path.lower().endswith('.png'):
                    mime_type = 'image/png'
                else:
                    raise ValueError(f'Unsupported file type: {file_path}')
            
            # Upload file to Gemini
            uploaded_file = upload_file(file_path, mime_type=mime_type)  # type: ignore  # type: ignore
            _uploaded_files.append(uploaded_file.uri)
            
            model_with_instructions = GenerativeModel(  # type: ignore
                model_name,
                system_instruction=bank_system_instruction,
                generation_config={
                    "response_mime_type": "application/json",
                    "temperature": 0.0,
                    "max_output_tokens": 15000,
                }
            )
            
            response = model_with_instructions.generate_content(
                [
                    uploaded_file,
                    "Extract bank transactions and format bank name with account number (format: 'Bank Name - Last 4 digits', e.g., 'Kotak Mahindra Bank - 8694') as JSON."
                ]
            )
        else:
            # Fallback to text if file_path not provided
            if not ocr_text:
                raise ValueError("Either file_path or ocr_text must be provided")
            
            model_with_instructions = GenerativeModel(  # type: ignore
                model_name,
                system_instruction=bank_system_instruction,
                generation_config={
                    "response_mime_type": "application/json",
                    "temperature": 0.0,
                    "max_output_tokens": 15000,
                }
            )
            
            response = model_with_instructions.generate_content(
                "Extract bank transactions and format bank name with account number (format: 'Bank Name - Last 4 digits', e.g., 'Kotak Mahindra Bank - 8694') as JSON.\n\nBANK_STATEMENT_TEXT:\n" + ocr_text
            )
        
        text = response.text
        
        # Safe parsing: extract JSON from response
        start = text.find('{')
        end = text.rfind('}')
        if start == -1 or end == -1:
            raise ValueError('Could not find JSON in model output')
        
        json_text = text[start:end+1]
        parsed = json.loads(json_text)
        
        # Check document type
        if parsed.get('documentType') == 'INVOICE':
            return {'error': 'Document is an invoice, not a bank statement', 'documentType': 'INVOICE'}
        
        # Extract bank details
        bank_name = str(parsed.get('bankName', '')).strip()
        account_number = str(parsed.get('accountNumber', '')).strip()
        account_number_last4 = str(parsed.get('accountNumberLast4', '')).strip()
        
        # Fallback: Extract last 4 digits from account number if accountNumberLast4 not provided
        if account_number and not account_number_last4:
            account_number_last4 = account_number[-4:]
        
        # Fallback: Format bank name with account number if Gemini didn't do it already
        formatted_bank_name = bank_name
        if account_number_last4 and ' - ' not in bank_name:
            formatted_bank_name = f"{bank_name} - {account_number_last4}"
        
        # Format transactions
        transactions = []
        for tx in parsed.get('transactions', []):
            date_value = (
                tx.get('transaction_date') or
                tx.get('date') or
                tx.get('txn_date') or
                ""
            )

            withdrawal = tx.get('withdrawal') or 0
            deposit = tx.get('deposit') or 0

            if withdrawal > 0:
                debit = format_amount(withdrawal)
                credit = format_amount(0.0)
                txn_type = "Payment"
            elif deposit > 0:
                debit = format_amount(0.0)
                credit = format_amount(deposit)
                txn_type = "Receipt"
            else:
                debit = format_amount(0.0)
                credit = format_amount(0.0)
                txn_type = tx.get('voucherType', 'Receipt')

            balance = tx.get("balance")
            if balance is not None:
                balance = format_amount(balance)

            transactions.append({
                "date": date_value,
                "description": tx.get("description", ""),
                "debit": debit,
                "credit": credit,
                "balance": balance,
                "type": txn_type,
                "suggested_ledger": tx.get("suggestedLedger", "Suspense A/c")
            })

        
        return {
            'bankName': formatted_bank_name,
            'accountNumber': account_number,
            'accountNumberLast4': account_number_last4,
            'transactions': transactions,
            'documentType': 'BANK_STATEMENT'
        }
    except json.JSONDecodeError as e:
        return {'error': 'Failed to parse bank statement as JSON', 'raw_response': text if 'text' in locals() else ''}
    except Exception as e:
        return {'error': str(e)}
    finally:
        # Cleanup uploaded file
        if uploaded_file:
            cleanup_uploaded_file(uploaded_file.uri)


def analyze_image_with_gemini(image_base64: str, custom_prompt: str = "") -> str:
    """Analyze an image using Google Gemini API with optional custom prompt."""
    api_key = os.getenv('GOOGLE_API_KEY')
    if genai is None:
        raise RuntimeError('google.generativeai package not installed')
    if not api_key:
        raise RuntimeError('GOOGLE_API_KEY not configured in environment')

    configure(api_key=api_key)  # type: ignore

    prompt = IMAGE_ANALYSIS_PROMPT.format(prompt=custom_prompt) if custom_prompt else "Provide a detailed analysis of this image."
    
    model_name = os.getenv('GENAI_MODEL', 'gemini-2.5-flash')
    model = GenerativeModel(model_name)  # type: ignore
    
    # Create image part for Gemini using inline data dict
    image_part = {
        "mime_type": "image/jpeg",
        "data": image_base64
    }
    
    response = model.generate_content(
        [prompt, image_part],
        generation_config={
            "temperature": 0.0,
            "max_output_tokens": 2000,
        }
    )
    
    return response.text


def get_chat_response(user_message: str, conversation_history: Optional[List[Dict[str, Any]]] = None) -> str:
    """Get conversational response from Gemini API."""
    api_key = os.getenv('GOOGLE_API_KEY')
    if genai is None:
        raise RuntimeError('google.generativeai package not installed')
    if not api_key:
        raise RuntimeError('GOOGLE_API_KEY not configured in environment')

    configure(api_key=api_key)

    model_name = os.getenv('GENAI_MODEL', 'gemini-2.5-flash')
    model = GenerativeModel(model_name)
    
    # Build conversation content
    if conversation_history is None:
        conversation_history = []
    
    # Add user message
    conversation_history.append({"role": "user", "parts": user_message})
    
    response = model.generate_content(
        conversation_history,
        generation_config={
            "temperature": 0.7,
            "max_output_tokens": 2000,
        }
    )
    
    # Add assistant response to history
    assistant_message = response.text
    conversation_history.append({"role": "model", "parts": assistant_message})
    
    return assistant_message

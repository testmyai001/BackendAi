# backend/genai_service.py
# type: ignore
import os
import json
import mimetypes
import time
import tempfile
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from functools import wraps

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

load_dotenv()

# Optional import — if not installed, functions raise with clear messages
try:
    import google.generativeai as genai
    GenerativeModel = genai.GenerativeModel  # type: ignore
    upload_file = genai.upload_file  # type: ignore
    configure = genai.configure  # type: ignore
except Exception:
    genai = None
    GenerativeModel = None
    upload_file = None
    configure = None

# Global client reuse
_genai_model = None
_bank_model = None
_uploaded_files: List[str] = []

def initialize_genai_if_needed():
    global _genai_model, _bank_model
    if _genai_model is not None and _bank_model is not None:
        return
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY not configured")
    if genai is None:
        raise RuntimeError("google.generativeai package not installed")
    configure(api_key=api_key)  # type: ignore

    model_name = os.getenv("GENAI_MODEL", "gemini-2.5-flash")
    invoice_system_instruction = """You are an expert Indian GST Invoice Accountant.
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
Goal: Return a clean JSON object."""
    bank_system_instruction = """You are an expert Tally Prime Accountant. 
Analyze the Bank Statement image/PDF.

CRITICAL DOCUMENT TYPE CHECK:
- Look at the document structure.
- If it contains "GSTIN", "Invoice Number", "Taxable Value", "CGST/SGST/IGST" columns, IT IS A TAX INVOICE.
- If it is a Tax Invoice, set the field 'documentType' to 'INVOICE'.
- If it is a valid Bank Statement, set 'documentType' to 'BANK_STATEMENT'.

Extract each transaction row into JSON.
Also extract the BANK NAME from the document header.

RULES FOR BANK NAME & ACCOUNT NUMBER:
1. **Identify Bank Name**: Extract from the statement header (e.g., HDFC, Kotak Mahindra, SBI, ICICI, Axis).
2. **Identify Account Number**: 
    - **CRITICAL PRIORITY**: Distinguish between different ID types:
    - IGNORE: "CRN", "CIF", "Customer ID", "User ID", "IFSC Code", "Reference Number", "Sort Code"
    - FIND: "Account No", "Account Number", "A/c No", "Ac No", "Acc No", "Account #"
    - The account number is typically 10-18 digits long
    - It usually appears near "Branch", "IFSC", or "Address"
3. **Extract Last 4 Digits CORRECTLY**: 
    - If Account Number is "1234567890", the last 4 digits are "7890"
    - If Account Number is "9876543210", the last 4 digits are "3210"
    - ALWAYS take the rightmost 4 digits of the account number
    - Do NOT reverse the number
    - Do NOT take digits from the middle
    - Do NOT use CRN, Customer ID, or any other field
4. **Format**: Return 'bankName' EXACTLY as "Bank Name - XXXX" and 'accountNumberLast4' as "XXXX"
    - Example 1: If Bank is "Kotak Mahindra Bank" and Account is "...8694", return:
      - bankName: "Kotak Mahindra Bank - 8694"
      - accountNumberLast4: "8694"
    - Example 2: If Bank is "HDFC Bank" and Account is "...5432", return:
      - bankName: "HDFC Bank - 5432"
      - accountNumberLast4: "5432"
    - CRITICAL: Verify the last 4 digits are from the actual account number, NOT CRN or any other field

RULES FOR TRANSACTIONS:
1. DATE: Standardize to YYYY-MM-DD.
2. TYPE: If Withdrawal/Debit -> "Payment". If Deposit/Credit -> "Receipt".
3. LEDGER GUESSING: Based on narration, guess the Tally Ledger Name (e.g., "UPI/SWIGGY" -> "Staff Welfare", "NEFT/KOTAK" -> "Kotak Bank"). Default to "Suspense A/c".
4. NUMBERS: Ensure withdrawal and deposit are numbers. If a row has both, split or prioritize the non-zero.
Return JSON only."""

    _genai_model = GenerativeModel(
        model_name,
        system_instruction=invoice_system_instruction,
        generation_config={"response_mime_type": "application/json", "temperature": 0.0, "max_output_tokens": 5000}
    )

    _bank_model = GenerativeModel(
        model_name,
        system_instruction=bank_system_instruction,
        generation_config={"response_mime_type": "application/json", "temperature": 0.0, "max_output_tokens": 148000}
    )

def extract_pdf_pages(file_path: str, pages_per_chunk: int = 10) -> List[str]:
    """
    Split PDF into chunks and write each chunk to a temporary PDF file.
    Returns list of temporary file paths for each chunk.
    """
    if PdfReader is None:
        raise RuntimeError("pypdf package not installed. Install with: pip install pypdf")
    
    try:
        reader = PdfReader(file_path)
        total_pages = len(reader.pages)
        chunk_paths = []
        
        # Create chunks of pages_per_chunk size
        for chunk_idx in range(0, total_pages, pages_per_chunk):
            end_idx = min(chunk_idx + pages_per_chunk, total_pages)
            
            # Create a temporary file for this chunk
            temp_fd, temp_path = tempfile.mkstemp(suffix=".pdf")
            os.close(temp_fd)
            
            try:
                from pypdf import PdfWriter
                writer = PdfWriter()
                
                # Add pages to this chunk
                for page_idx in range(chunk_idx, end_idx):
                    writer.add_page(reader.pages[page_idx])
                
                # Write chunk to temporary file
                with open(temp_path, "wb") as temp_file:
                    writer.write(temp_file)
                
                chunk_paths.append(temp_path)
            except Exception as e:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                raise e
        
        return chunk_paths
    except Exception as e:
        raise RuntimeError(f"Error splitting PDF: {str(e)}")

def aggregate_bank_transactions(all_chunks_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Aggregate results from multiple PDF chunks into a single result.
    Deduplicates transactions by (date, description, withdrawal, deposit) tuple.
    """
    unique_transactions = {}
    bank_name = ""
    account_number = ""
    account_last4 = ""
    
    for chunk_data in all_chunks_data:
        # Get bank info from first non-empty chunk
        if not bank_name and chunk_data.get("bankName"):
            bank_name = chunk_data.get("bankName", "")
            account_number = chunk_data.get("accountNumber", "")
            account_last4 = chunk_data.get("accountNumberLast4", "")
        
        # Aggregate transactions with deduplication
        for tx in chunk_data.get("transactions", []):
            # Create a unique key: (date, description, withdrawal, deposit)
            key = (
                tx.get("transaction_date", tx.get("date", "")),
                tx.get("description", ""),
                float(tx.get("withdrawal", 0) or 0),
                float(tx.get("deposit", 0) or 0)
            )
            
            # Only add if not already seen (deduplication)
            if key not in unique_transactions:
                unique_transactions[key] = tx
    
    # Convert back to list and calculate totals
    transactions = list(unique_transactions.values())
    total_withdrawals = sum(float(tx.get("withdrawal", 0) or 0) for tx in transactions)
    total_deposits = sum(float(tx.get("deposit", 0) or 0) for tx in transactions)
    
    return {
        "documentType": "BANK_STATEMENT",
        "bankName": bank_name,
        "accountNumber": account_number,
        "accountNumberLast4": account_last4,
        "transactions": transactions,
        "totalWithdrawals": round(total_withdrawals, 2),
        "totalDeposits": round(total_deposits, 2)
    }

def retry_with_backoff(max_attempts=3, base_delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last = e
                    if attempt < max_attempts - 1:
                        time.sleep(base_delay * (2 ** attempt))
                    else:
                        raise
            raise last
        return wrapper
    return decorator

def format_amount(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except Exception:
        return 0.00

def cleanup_uploaded_file(file_uri: Optional[str]) -> bool:
    if not file_uri or genai is None:
        return False
    try:
        file_id = file_uri.split("/")[-1] if "/" in file_uri else file_uri
        # use genai SDK cleanup
        try:
            genai.delete_file(file_id)  # type: ignore
        except Exception:
            pass
        if file_uri in _uploaded_files:
            _uploaded_files.remove(file_uri)
        return True
    except Exception:
        return False

# Shared prompts (kept short to reduce chance of long text exposures)
INVOICE_PROMPT = """
You are a parser. Return valid JSON only with fields:
documentType, invoiceNumber, invoiceDate (DD-MM-YYYY), supplierName, supplierGstin,
buyerName, buyerGstin, lineItems [{description, hsn, quantity, rate, amount, gstRate, unit}], taxableValue, total
If not invoice set documentType to INVALID.
"""
BANK_PROMPT = """
You are a bank statement parser. Return valid JSON only with fields:
documentType (BANK_STATEMENT|INVOICE), bankName, accountNumber, accountNumberLast4,
transactions [{transaction_date (YYYY-MM-DD), description, withdrawal, deposit, balance, voucherType, suggestedLedger}]
"""

@retry_with_backoff(max_attempts=3, base_delay=1)
def parse_invoice_with_gemini(file_path: str) -> Dict[str, Any]:
    """
    Upload file to Gemini Vision and request structured JSON.
    Returns a dict or {'error': ...}
    """
    if genai is None:
        return {"error": "google.generativeai package not installed"}
    try:
        initialize_genai_if_needed()
        # determine mime
        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            if file_path.lower().endswith(".pdf"):
                mime_type = "application/pdf"
            elif file_path.lower().endswith((".jpg", ".jpeg")):
                mime_type = "image/jpeg"
            elif file_path.lower().endswith(".png"):
                mime_type = "image/png"
            else:
                return {"error": f"Unsupported file type: {file_path}"}

        uploaded = upload_file(file_path, mime_type=mime_type)  # may raise
        _uploaded_files.append(uploaded.uri)

        model = GenerativeModel(os.getenv("GENAI_MODEL", "gemini-2.5-flash"),
                                system_instruction=INVOICE_PROMPT,
                                generation_config={"response_mime_type": "application/json", "temperature": 0.0})
        response = model.generate_content([uploaded, "Extract invoice JSON only."])

        text = response.text or ""
        # Extract JSON substring safely
        s = text.find("{")
        e = text.rfind("}")
        if s == -1 or e == -1:
            cleanup_uploaded_file(uploaded.uri)
            return {"error": "No JSON found in AI response", "raw": text[:1000]}
        try:
            parsed = json.loads(text[s:e+1])
        except Exception as exc:
            cleanup_uploaded_file(uploaded.uri)
            return {"error": f"JSON decode error: {str(exc)}", "raw": text[:1000]}
        cleanup_uploaded_file(uploaded.uri)
        return parsed
    except Exception as e:
        return {"error": str(e)}

@retry_with_backoff(max_attempts=3, base_delay=1)
def parse_bank_statement_with_gemini(ocr_text: Optional[str] = None, file_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Accepts file_path (preferred) or ocr_text fallback.
    For PDFs, uses page-by-page chunking to handle large statements (300+ transactions).
    Returns structured dict or {'error':...}
    """
    if genai is None:
        return {"error": "google.generativeai package not installed"}
    try:
        initialize_genai_if_needed()
        model = GenerativeModel(os.getenv("GENAI_MODEL", "gemini-2.5-flash"),
                                system_instruction=BANK_PROMPT,
                                generation_config={"response_mime_type": "application/json", "temperature": 0.0, "max_output_tokens": 20000})

        # Handle PDF with chunking if it's a PDF file
        if file_path and file_path.lower().endswith(".pdf"):
            try:
                chunk_paths = extract_pdf_pages(file_path, pages_per_chunk=10)
                all_chunks_data = []
                
                for chunk_path in chunk_paths:
                    try:
                        mime_type = "application/pdf"
                        uploaded = upload_file(chunk_path, mime_type=mime_type)
                        _uploaded_files.append(uploaded.uri)
                        
                        response = model.generate_content([uploaded, "Extract bank statement JSON only."])
                        text = response.text or ""
                        
                        # Extract JSON from response
                        s = text.find("{")
                        e = text.rfind("}")
                        if s != -1 and e != -1:
                            try:
                                parsed = json.loads(text[s:e+1])
                                
                                # Skip if this chunk detected an invoice
                                if parsed.get("documentType") != "INVOICE":
                                    all_chunks_data.append(parsed)
                            except json.JSONDecodeError:
                                pass
                        
                        cleanup_uploaded_file(uploaded.uri)
                    except Exception as e:
                        print(f"Error processing chunk {chunk_path}: {str(e)}")
                        continue
                    finally:
                        # Cleanup chunk file
                        if os.path.exists(chunk_path):
                            try:
                                os.remove(chunk_path)
                            except:
                                pass
                
                if not all_chunks_data:
                    return {"error": "No valid bank statement data extracted from PDF chunks"}
                
                # Aggregate results from all chunks
                aggregated = aggregate_bank_transactions(all_chunks_data)
                return aggregated
            
            except RuntimeError as e:
                # pypdf not installed or PDF split failed
                # Fall through to single-file processing
                pass
        
        # Single file processing (images or fallback for PDFs)
        uploaded = None
        if file_path:
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                if file_path.lower().endswith(".pdf"):
                    mime_type = "application/pdf"
                elif file_path.lower().endswith((".jpg", ".jpeg")):
                    mime_type = "image/jpeg"
                elif file_path.lower().endswith(".png"):
                    mime_type = "image/png"
                else:
                    return {"error": f"Unsupported file type: {file_path}"}
            
            uploaded = upload_file(file_path, mime_type=mime_type)
            _uploaded_files.append(uploaded.uri)
            response = model.generate_content([uploaded, "Extract bank statement JSON only."])
            text = response.text or ""
        else:
            if not ocr_text:
                return {"error": "No input provided"}
            response = model.generate_content("Extract bank statement JSON only.\n\n" + ocr_text)
            text = response.text or ""

        s = text.find("{")
        e = text.rfind("}")
        if s == -1 or e == -1:
            if uploaded:
                cleanup_uploaded_file(uploaded.uri)
            return {"error": "No JSON found in AI response", "raw": text[:1000]}

        try:
            parsed = json.loads(text[s:e+1])
        except Exception as exc:
            if uploaded:
                cleanup_uploaded_file(uploaded.uri)
            return {"error": f"JSON decode error: {str(exc)}", "raw": text[:1000]}

        # If model accidentally identifies invoice inside bank statement, return clear error
        if parsed.get("documentType") == "INVOICE":
            if uploaded:
                cleanup_uploaded_file(uploaded.uri)
            return {"error": "Detected TAX INVOICE inside bank statement area", "documentType": "INVOICE"}

        # normalize transactions
        transactions = []
        total_withdrawals = 0.0
        total_deposits = 0.0
        for tx in parsed.get("transactions", []) if isinstance(parsed.get("transactions", []), list) else []:
            try:
                withdrawal = float(tx.get("withdrawal") or tx.get("withdrawal_amount") or 0)
            except Exception:
                withdrawal = 0.0
            try:
                deposit = float(tx.get("deposit") or tx.get("deposit_amount") or 0)
            except Exception:
                deposit = 0.0

            total_withdrawals += withdrawal
            total_deposits += deposit

            txn_date = tx.get("transaction_date") or tx.get("date") or ""
            suggested = tx.get("suggestedLedger") or tx.get("suggested_ledger") or tx.get("suggestedLedger", "Suspense A/c")

            transactions.append({
                "transaction_date": txn_date,
                "description": tx.get("description") or tx.get("narration") or "",
                "withdrawal": format_amount(withdrawal),
                "deposit": format_amount(deposit),
                "balance": format_amount(tx.get("balance") or 0),
                "voucherType": tx.get("voucherType") or ("Payment" if withdrawal > 0 else "Receipt"),
                "suggestedLedger": suggested
            })

        if uploaded:
            cleanup_uploaded_file(uploaded.uri)

        # Format bank name with account last 4 digits
        bank_name = parsed.get("bankName") or parsed.get("bank_name") or ""
        account_number = parsed.get("accountNumber") or ""
        account_last4 = parsed.get("accountNumberLast4") or parsed.get("accountNumberLast4") or ""
        
        # Validation: If account number is provided, verify/extract last 4 digits correctly
        if account_number and not account_last4:
            # Extract last 4 digits from account number if not provided by Gemini
            digits_only = ''.join(filter(str.isdigit, account_number))
            if len(digits_only) >= 4:
                account_last4 = digits_only[-4:]  # Take rightmost 4 digits
        elif account_number and account_last4:
            # Verify that account_last4 is actually the last 4 digits of account_number
            digits_only = ''.join(filter(str.isdigit, account_number))
            if len(digits_only) >= 4:
                correct_last4 = digits_only[-4:]
                # If Gemini extracted wrong digits, correct it
                if account_last4 != correct_last4:
                    print(f"Warning: Correcting account last 4 digits from {account_last4} to {correct_last4}")
                    account_last4 = correct_last4
        
        if bank_name and account_last4:
            formatted_bank_name = f"{bank_name} - {account_last4}"
        else:
            formatted_bank_name = bank_name

        return {
            "documentType": "BANK_STATEMENT",
            "bankName": formatted_bank_name,
            "accountNumber": account_number,
            "accountNumberLast4": account_last4,
            "transactions": transactions,
            "totalWithdrawals": round(total_withdrawals, 2),
            "totalDeposits": round(total_deposits, 2)
        }
    except Exception as e:
        return {"error": str(e)}

def analyze_image_with_gemini(file_path: str, custom_prompt: str = "") -> str:
    """Analyze an image using Gemini Vision API with proper file upload.
    
    Args:
        file_path: Path to the image file (will be uploaded to Gemini)
        custom_prompt: Custom analysis prompt
    
    Returns:
        Text analysis from Gemini
    """
    if genai is None:
        raise RuntimeError("google.generativeai package not installed")
    
    initialize_genai_if_needed()
    
    # Detect MIME type from file extension
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type or not mime_type.startswith('image/'):
        if file_path.lower().endswith(".jpg") or file_path.lower().endswith(".jpeg"):
            mime_type = "image/jpeg"
        elif file_path.lower().endswith(".png"):
            mime_type = "image/png"
        elif file_path.lower().endswith(".gif"):
            mime_type = "image/gif"
        elif file_path.lower().endswith(".webp"):
            mime_type = "image/webp"
        else:
            raise ValueError(f"Unsupported image type: {file_path}")
    
    try:
        # Upload file to Gemini (proper way, same as invoice/bank statement)
        uploaded = upload_file(file_path, mime_type=mime_type)
        _uploaded_files.append(uploaded.uri)
        
        model = GenerativeModel(os.getenv("GENAI_MODEL", "gemini-2.5-flash"))
        prompt = custom_prompt or "Analyze this image and provide detailed insights."
        
        response = model.generate_content(
            [prompt, uploaded],
            generation_config={"temperature": 0.0, "max_output_tokens": 2000}
        )
        
        result = response.text or ""
        cleanup_uploaded_file(uploaded.uri)
        return result
    
    except Exception as e:
        print(f"Error analyzing image: {str(e)}")
        raise

def get_chat_response(user_message: str, conversation_history: Optional[List[Dict[str, Any]]] = None) -> str:
    if genai is None:
        raise RuntimeError("google.generativeai package not installed")
    initialize_genai_if_needed()
    model = GenerativeModel(os.getenv("GENAI_MODEL", "gemini-2.5-flash"))
    if conversation_history is None:
        conversation_history = []
    conversation_history.append({"role": "user", "parts": user_message})
    response = model.generate_content(conversation_history, generation_config={"temperature": 0.7, "max_output_tokens": 2000})
    assistant_message = response.text or ""
    conversation_history.append({"role": "model", "parts": assistant_message})
    return assistant_message

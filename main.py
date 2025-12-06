# backend/main.py
import os
import uuid
import logging
import traceback
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv

from ocr_service import ocr_from_file
from genai_service import (
    parse_invoice_with_gemini,
    parse_bank_statement_with_gemini,
    analyze_image_with_gemini,
    get_chat_response,
)
from tally_service import (
    generate_tally_xml,
    generate_bank_statement_xml,
    push_to_tally,
    check_tally_connection,
    fetch_existing_ledgers,
    fetch_open_companies,
)
from utils import save_upload_file

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backend")

app = FastAPI(title="Invoice Processor Backend (Hardened)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/", response_class=HTMLResponse)
async def root():
    return "<html><body><h2>Invoice Processor Backend — Running</h2></body></html>"


# ---------------------------
# Helpers
# ---------------------------
def _unwrap_result(result: dict, raise_on_error: bool = True):
    """
    Normalizes return from genai_service functions:
    - If result contains 'error' -> raise HTTPException(422)
    - Otherwise return result
    """
    if not isinstance(result, dict):
        if raise_on_error:
            raise HTTPException(status_code=422, detail="AI returned unexpected format")
        return {"error": "unexpected_format"}

    if "error" in result and result.get("error"):
        if raise_on_error:
            # Use 422 for parse issues, 500 for others could be used depending on message
            detail = result.get("error")
            # DO NOT include raw AI content in HTTP errors for security.
            logger.debug("AI parse error (masked): %s", str(detail))
            raise HTTPException(status_code=422, detail=str(detail))
        return result
    return result


# ---------------------------
# Process invoice
# ---------------------------
@app.post("/process-invoice")
async def process_invoice(file: UploadFile = File(...), use_gemini_direct: bool = True):
    file_path = None
    file_id = None
    try:
        # save uploaded file
        file_id = save_upload_file(file, UPLOAD_DIR)
        file_path = os.path.join(UPLOAD_DIR, file_id)
        logger.info("Saved upload %s", file_id)

        # call genai service
        if use_gemini_direct:
            parsed = parse_invoice_with_gemini(file_path=file_path)
        else:
            ocr_text = ocr_from_file(file_path)
            parsed = parse_invoice_with_gemini(file_path=file_path)

        parsed = _unwrap_result(parsed)

        # Defensive extraction with multiple key names
        def _get(d, *keys, default=""):
            for k in keys:
                if k in d and d[k] not in (None, ""):
                    return d[k]
            return default

        invoice_number = _get(parsed, "invoice_number", "invoiceNumber", "invoice_number", "")
        invoice_date = _get(parsed, "invoice_date", "invoiceDate", "")
        supplier_name = _get(parsed, "supplier_name", "supplierName", "")
        supplier_gstin = _get(parsed, "gstin", "supplier_gstin", "supplierGstin", "")
        buyer_name = _get(parsed, "buyer_name", "buyerName", "")
        buyer_gstin = _get(parsed, "buyer_gstin", "buyerGstin", "")

        taxable = float(parsed.get("taxable", parsed.get("taxableValue", 0) or 0))
        cgst = float(parsed.get("cgst", 0) or 0)
        sgst = float(parsed.get("sgst", 0) or 0)
        igst = float(parsed.get("igst", 0) or 0)
        total = float(parsed.get("total", 0) or 0)

        raw_items = parsed.get("line_items", parsed.get("lineItems", [])) or []
        line_items = []
        for it in raw_items:
            # keep robust mapping
            line_items.append({
                "id": str(uuid.uuid4()),
                "description": it.get("description") or it.get("desc") or it.get("name") or "",
                "hsn": it.get("hsn") or "",
                "quantity": float(it.get("qty") or it.get("quantity") or 0),
                "rate": float(it.get("rate") or it.get("price") or 0),
                "amount": float(it.get("amount") or it.get("taxableAmount") or 0),
                "gstRate": float(it.get("gst_rate") or it.get("gstRate") or it.get("gst") or 18),
                "unit": it.get("unit") or it.get("uom") or "Nos"
            })

        response = {
            "id": str(uuid.uuid4()),
            "invoiceNumber": invoice_number,
            "invoiceDate": invoice_date,
            "supplierName": supplier_name,
            "supplierGstin": supplier_gstin,
            "buyerName": buyer_name,
            "buyerGstin": buyer_gstin,
            "taxable": taxable,
            "igst": igst,
            "cgst": cgst,
            "sgst": sgst,
            "total": total,
            "lineItems": line_items
        }
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error("process_invoice error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # cleanup uploaded file
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                logger.debug("Could not remove file %s", file_path)


# ---------------------------
# Process bank statement
# ---------------------------
@app.post("/process-bank-statement")
async def process_bank_statement(file: UploadFile = File(...), use_gemini_direct: bool = True):
    file_path = None
    file_id = None
    try:
        # Validate file size (max 50MB for PDFs, 20MB for images)
        file_size = file.size or 0
        if file_size > 50 * 1024 * 1024:  # 50MB limit
            raise HTTPException(status_code=413, detail="File size exceeds 50MB limit")
        
        file_id = save_upload_file(file, UPLOAD_DIR)
        file_path = os.path.join(UPLOAD_DIR, file_id)
        logger.info("Saved bank upload %s", file_id)

        if use_gemini_direct:
            parsed = parse_bank_statement_with_gemini(file_path=file_path)
        else:
            ocr_text = ocr_from_file(file_path)
            parsed = parse_bank_statement_with_gemini(ocr_text=ocr_text)

        parsed = _unwrap_result(parsed)

        # Normalize transactions to frontend shape
        transactions = []
        for tx in parsed.get("transactions", []) or []:
            transactions.append({
                "id": str(uuid.uuid4()),
                "date": tx.get("date") or tx.get("transaction_date") or tx.get("txn_date") or "",
                "description": tx.get("description") or tx.get("narration") or "",
                "type": tx.get("type") or tx.get("voucherType") or "Payment",
                "debit": float(tx.get("debit") or tx.get("withdrawal") or 0),
                "credit": float(tx.get("credit") or tx.get("deposit") or 0),
                "voucherType": tx.get("voucherType") or tx.get("type") or "Payment",
                "contraLedger": tx.get("suggested_ledger") or tx.get("suggestedLedger") or "Suspense A/c",
            })

        response = {
            "id": str(uuid.uuid4()),
            "documentType": "BANK_STATEMENT",
            "bankName": parsed.get("bankName") or parsed.get("bank_name") or "",
            "statementDate": parsed.get("statementDate") or "",
            "transactionCount": len(transactions),
            "transactions": transactions,
            "totalWithdrawals": parsed.get("totalWithdrawals") or 0,
            "totalDeposits": parsed.get("totalDeposits") or 0
        }
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error("process_bank_statement error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                logger.debug("Could not remove file %s", file_path)


# ---------------------------
# Calculate totals (stateless)
# ---------------------------
@app.post("/calculate-totals")
async def calculate_totals(payload: dict):
    try:
        # reuse the same calculation logic as your previous implementation
        line_items = payload.get("lineItems", []) or []
        def r(n): return round(float(n or 0) + 1e-9, 2)

        total_taxable = 0.0
        total_cgst = 0.0
        total_sgst = 0.0
        line_item_totals = []

        for it in line_items:
            amount = float(it.get("amount", 0) or 0)
            gst_rate = float(it.get("gstRate", 0) or 0)
            total_taxable += amount
            cgst = r(amount * (gst_rate / 2) / 100)
            sgst = r(amount * (gst_rate / 2) / 100)
            total_cgst += cgst
            total_sgst += sgst
            line_item_totals.append({"cgst": cgst, "sgst": sgst})

        total_taxable = r(total_taxable)
        total_cgst = r(total_cgst)
        total_sgst = r(total_sgst)
        total_gst = r(total_cgst + total_sgst)
        grand_total = r(total_taxable + total_gst)

        return {"taxable": total_taxable, "cgst": total_cgst, "sgst": total_sgst, "total": grand_total, "lineItemTotals": line_item_totals}

    except Exception as e:
        logger.error("calculate_totals error: %s", traceback.format_exc())
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------
# Chat & image analyze endpoints (thin wrappers)
# ---------------------------
@app.post("/chat")
async def chat(payload: dict):
    try:
        message = payload.get("message", "")
        history = payload.get("history", [])
        if not message:
            raise HTTPException(status_code=400, detail="message required")
        resp = get_chat_response(message, history)
        return {"text": resp}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("chat error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...), prompt: str = ""):
    file_path = None
    try:
        file_id = save_upload_file(file, UPLOAD_DIR)
        file_path = os.path.join(UPLOAD_DIR, file_id)
        # Pass file_path directly to analyze function (it will upload to Gemini properly)
        text = analyze_image_with_gemini(file_path, prompt)
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("analyze_image error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass


# ---------------------------
# Utility endpoints (tally helper)
# ---------------------------
@app.post("/upload")
async def upload_file_endpoint(file: UploadFile = File(...)):
    try:
        file_id = save_upload_file(file, UPLOAD_DIR)
        return {"file_id": file_id}
    except Exception as e:
        logger.error("upload error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ocr")
async def ocr_endpoint(file_id: str):
    path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="file not found")
    try:
        text = ocr_from_file(path)
        return {"text": text}
    except Exception as e:
        logger.error("ocr error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tally/proxy")
async def tally_proxy(payload: dict):
    try:
        xml = payload.get("payload", "")
        if not xml:
            raise HTTPException(status_code=400, detail="payload required")
        res = push_to_tally(xml)
        return res
    except HTTPException:
        raise
    except Exception as e:
        logger.error("tally proxy error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tally/check-connection")
async def tally_check():
    return check_tally_connection()


@app.get("/tally/existing-ledgers")
async def tally_ledgers():
    try:
        ledgers = fetch_existing_ledgers()
        return {"ledgers": list(ledgers)}
    except Exception as e:
        logger.error("fetch existing ledgers error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tally/open-companies")
async def tally_companies():
    try:
        companies = fetch_open_companies()
        return {"companies": companies}
    except Exception as e:
        logger.error("fetch companies error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))

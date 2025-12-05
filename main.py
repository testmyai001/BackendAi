from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, HTMLResponse
import os
import uuid
import base64
from dotenv import load_dotenv

from ocr_service import ocr_from_file
from genai_service import (
    parse_invoice_with_gemini,
    parse_bank_statement_with_gemini,
    analyze_image_with_gemini,
    get_chat_response
)
from tally_service import (
    generate_tally_xml,
    generate_bank_statement_xml,
    push_to_tally,
    check_tally_connection,
    fetch_existing_ledgers,
    fetch_open_companies
)
from utils import save_upload_file

load_dotenv()

# ============================================================================
# STARTUP VALIDATION
# ============================================================================

def validate_startup_config():
    """Validate required environment variables on startup."""
    google_api_key = os.getenv('GOOGLE_API_KEY')
    if not google_api_key:
        raise RuntimeError(
            '❌ CRITICAL: GOOGLE_API_KEY environment variable not configured.\n'
            '   Set GOOGLE_API_KEY in .env file for AI features to work.'
        )
    print('✅ GOOGLE_API_KEY configured')

try:
    validate_startup_config()
except RuntimeError as e:
    print(f'⚠️  Startup Warning: {e}')
    # Continue anyway, will fail when API is called

app = FastAPI(title="Invoice Processor Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ============================================================================
# ROOT ENDPOINT - Backend Status
# ============================================================================

@app.get("/", response_class=HTMLResponse)
async def root():
    """Display backend status page."""
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice Processor Backend</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            .container {
                background: white;
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                max-width: 800px;
                width: 100%;
                padding: 40px;
            }
            .header {
                text-align: center;
                margin-bottom: 30px;
            }
            .status-badge {
                display: inline-block;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                color: white;
                padding: 10px 20px;
                border-radius: 50px;
                font-weight: bold;
                margin-bottom: 15px;
                font-size: 14px;
            }
            h1 {
                color: #1f2937;
                font-size: 32px;
                margin-bottom: 10px;
            }
            .subtitle {
                color: #6b7280;
                font-size: 16px;
            }
            .section {
                margin: 30px 0;
                padding: 20px;
                background: #f3f4f6;
                border-radius: 8px;
                border-left: 4px solid #667eea;
            }
            .section h2 {
                color: #1f2937;
                font-size: 18px;
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .section ul {
                list-style: none;
                padding-left: 0;
            }
            .section li {
                color: #374151;
                padding: 8px 0;
                border-bottom: 1px solid #e5e7eb;
            }
            .section li:last-child {
                border-bottom: none;
            }
            .endpoint {
                background: white;
                padding: 10px 15px;
                border-radius: 6px;
                margin: 5px 0;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .method {
                font-weight: bold;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 11px;
                min-width: 50px;
                text-align: center;
            }
            .method.post { background: #fca5a5; color: #7f1d1d; }
            .method.get { background: #a7f3d0; color: #065f46; }
            .links {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin: 15px 0;
            }
            .link-btn {
                display: block;
                padding: 12px;
                background: #667eea;
                color: white;
                text-decoration: none;
                border-radius: 6px;
                text-align: center;
                font-weight: 500;
                transition: background 0.3s;
            }
            .link-btn:hover {
                background: #764ba2;
            }
            .link-btn.docs {
                background: #10b981;
            }
            .link-btn.docs:hover {
                background: #059669;
            }
            .feature-list {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin: 15px 0;
            }
            .feature-item {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #374151;
            }
            .checkmark {
                color: #10b981;
                font-weight: bold;
                font-size: 18px;
            }
            .info-box {
                background: #eff6ff;
                border-left: 4px solid #3b82f6;
                padding: 15px;
                border-radius: 6px;
                margin: 15px 0;
                color: #1e40af;
                font-size: 14px;
            }
            .footer {
                text-align: center;
                margin-top: 30px;
                padding-top: 20px;
                border-top: 1px solid #e5e7eb;
                color: #6b7280;
                font-size: 12px;
            }
            @media (max-width: 600px) {
                .links { grid-template-columns: 1fr; }
                .feature-list { grid-template-columns: 1fr; }
                h1 { font-size: 24px; }
                .container { padding: 20px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="status-badge">✅ RUNNING</div>
                <h1>Invoice Processor Backend</h1>
                <p class="subtitle">AI-Powered Invoice & Bank Statement Processing</p>
            </div>

            <div class="section">
                <h2>📚 Quick Links</h2>
                <div class="links">
                    <a href="/docs" class="link-btn docs">📖 API Documentation (Swagger)</a>
                    <a href="/redoc" class="link-btn docs">📋 ReDoc</a>
                    <a href="/openapi.json" class="link-btn">🔗 OpenAPI Spec</a>
                </div>
            </div>

            <div class="section">
                <h2>🚀 New Consolidated Endpoints</h2>
                <ul>
                    <li><div class="endpoint"><span class="method post">POST</span> <strong>/process-invoice</strong> - Complete invoice pipeline (upload → OCR → parse → save)</div></li>
                    <li><div class="endpoint"><span class="method post">POST</span> <strong>/process-bank-statement</strong> - Bank statement processing</div></li>
                    <li><div class="endpoint"><span class="method post">POST</span> <strong>/chat</strong> - Conversational AI with history</div></li>
                    <li><div class="endpoint"><span class="method post">POST</span> <strong>/analyze-image</strong> - Image analysis with Gemini Vision</div></li>
                </ul>
            </div>

            <div class="section">
                <h2>🔧 Core Features</h2>
                <div class="feature-list">
                    <div class="feature-item"><span class="checkmark">✓</span> Invoice OCR & AI Parsing</div>
                    <div class="feature-item"><span class="checkmark">✓</span> Bank Statement Processing</div>
                    <div class="feature-item"><span class="checkmark">✓</span> Conversational Chat</div>
                    <div class="feature-item"><span class="checkmark">✓</span> Image Analysis</div>
                    <div class="feature-item"><span class="checkmark">✓</span> Tally ERP Integration</div>
                    <div class="feature-item"><span class="checkmark">✓</span> SQLite Database</div>
                    <div class="feature-item"><span class="checkmark">✓</span> CORS Enabled</div>
                    <div class="feature-item"><span class="checkmark">✓</span> Auto DB Initialization</div>
                </div>
            </div>


            <div class="info-box">
                <strong>🔑 Getting Started:</strong><br>
                1. Visit <strong>/docs</strong> for interactive API documentation<br>
                2. Test endpoints with sample files<br>
                3. Set <strong>GOOGLE_API_KEY</strong> in .env for AI features<br>
                4. Responses include database IDs for frontend integration
            </div>

            <div class="section">
                <h2>📱 Frontend Integration</h2>
                <p style="color: #374151; margin-bottom: 10px;">Base URL: <code style="background: white; padding: 2px 6px; border-radius: 4px;">http://localhost:8000</code></p>
                <p style="color: #6b7280; font-size: 13px;">All endpoints support multipart/form-data for file uploads and application/json for data requests. CORS is enabled for all origins.</p>
            </div>

            <div class="footer">
                <p>🚀 Backend Status: <strong>OPERATIONAL</strong></p>
                <p style="margin-top: 5px; font-size: 11px;">December 4, 2025 | Python FastAPI + SQLite</p>
            </div>
        </div>
    </body>
    </html>
    """


# ============================================================================
# NEW CONSOLIDATED ENDPOINTS (Matching TypeScript Frontend API Contract)
# ============================================================================

@app.post("/process-invoice")
async def process_invoice(file: UploadFile = File(...), use_gemini_direct: bool = True):
    """
    Consolidated endpoint: Upload → Parse
    
    Query Parameters:
    - use_gemini_direct: If True (default), uses Gemini Vision API directly without OCR.
                         If False, falls back to OCR → Parse workflow.
    
    Returns structured invoice data ready for use on frontend (camelCase).
    """
    file_path = None
    try:
        # Step 1: Save uploaded file
        file_id = save_upload_file(file, UPLOAD_DIR)
        file_path = os.path.join(UPLOAD_DIR, file_id)
        
        # Step 2: Parse with Gemini (direct Vision API or OCR)
        if use_gemini_direct:
            parsed_data = parse_invoice_with_gemini(file_path=file_path)

            ocr_text = ""
        else:
            ocr_text = ocr_from_file(file_path)
            parsed_data = parse_invoice_with_gemini(file_path)
        
        # Step 3: Check for parsing errors
        if 'error' in parsed_data:
            raise HTTPException(status_code=422, detail=f"Failed to parse invoice: {parsed_data.get('error', 'Unknown error')}")
        
        # Step 4: Extract and normalize data with defensive programming
        def _get_field(*keys, default=None):
            """Try multiple key names for flexibility"""
            for key in keys:
                if key in parsed_data:
                    val = parsed_data[key]
                    if val is not None:
                        return val
            return default
        
        # Extract invoice metadata
        invoice_number = _get_field("invoice_number", "invoiceNumber", "")
        invoice_date = _get_field("invoice_date", "invoiceDate", "")
        supplier_name = _get_field("supplier_name", "supplierName", "")
        supplier_gstin = _get_field("gstin", "supplier_gstin", "supplierGstin", "")
        buyer_name = _get_field("buyer_name", "buyerName", "")
        buyer_gstin = _get_field("buyer_gstin", "buyerGstin", "")
        
        print(f"DEBUG [main.py] - Parsed data keys: {list(parsed_data.keys())}")
        print(f"DEBUG [main.py] - supplier_gstin (gstin key): {parsed_data.get('gstin', 'NOT_FOUND')}")
        print(f"DEBUG [main.py] - Extracted supplier_gstin: '{supplier_gstin}'")
        
        # Extract tax values
        taxable_val = float(_get_field("taxable", "taxableValue", default=0) or 0)
        cgst_total = float(_get_field("cgst", default=0) or 0)
        sgst_total = float(_get_field("sgst", default=0) or 0)
        igst_val = float(_get_field("igst", default=0) or 0)
        total_val = float(_get_field("total", "grand_total", "grandTotal", default=0) or 0)
        
        # Step 5: Format line items
        items_data = _get_field("line_items", "lineItems", []) or []
        line_items = []
        
        for item in items_data:
            def _li_get(*keys, default=None):
                """Get from line item with multiple key options"""
                for k in keys:
                    if k in item:
                        val = item[k]
                        if val is not None:
                            return val
                return default
            
            line_items.append({
                "id": str(uuid.uuid4()),
                "description": _li_get("description", "desc", "name", default=""),
                "hsn": _li_get("hsn", "hsnCode", default=""),
                "quantity": float(_li_get("quantity", "qty", default=0) or 0),
                "rate": float(_li_get("rate", "price", default=0) or 0),
                "amount": float(_li_get("amount", "taxableAmount", default=0) or 0),
                "gstRate": float(_li_get("gst_rate", "gstRate", "gst", default=18) or 18),
                "cgst": float(_li_get("cgst", "CGST", default=0) or 0),
                "sgst": float(_li_get("sgst", "SGST", default=0) or 0),
                "unit": _li_get("unit", "uom", default="Nos"),
            })
        
        # Step 6: Return formatted response (camelCase)
        return {
            "id": str(uuid.uuid4()),
            "invoiceNumber": invoice_number,
            "invoiceDate": invoice_date,
            "supplierName": supplier_name,
            "supplierGstin": supplier_gstin,
            "buyerName": buyer_name,
            "buyerGstin": buyer_gstin,
            "taxable": taxable_val,
            "igst": igst_val,
            "cgst": cgst_total,
            "sgst": sgst_total,
            "total": total_val,
            "lineItems": line_items
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Invoice processing failed: {str(e)}")
    finally:
        # Cleanup uploaded file after processing
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Warning: Could not delete file {file_path}: {e}")


@app.post("/process-bank-statement")
async def process_bank_statement(file: UploadFile = File(...), use_gemini_direct: bool = True):
    """
    Process bank statement using Gemini Vision API.
    
    Query Parameters:
    - use_gemini_direct: If True (default), uses Gemini Vision API directly without OCR.
                         If False, falls back to OCR → Parse workflow.
    
    Returns structured bank statement data with transactions (camelCase).
    """
    file_path = None
    try:
        # Step 1: Save uploaded file
        file_id = save_upload_file(file, UPLOAD_DIR)
        file_path = os.path.join(UPLOAD_DIR, file_id)
        
        # Step 2: Parse with Gemini
        if use_gemini_direct:
            parsed_data = parse_bank_statement_with_gemini(file_path=file_path)

        else:
            ocr_text = ocr_from_file(file_path)
            parsed_data = parse_bank_statement_with_gemini(ocr_text=ocr_text)
        
        # Step 3: Check for parsing errors
        if 'error' in parsed_data:
            raise HTTPException(status_code=422, detail=f"Failed to parse bank statement: {parsed_data.get('error', 'Unknown error')}")
        
        # Step 4: Format response (camelCase)
        transactions = parsed_data.get("transactions", [])
        formatted_transactions = [
            {
                "id": str(uuid.uuid4()),
                "transactionDate": tx.get("transaction_date", ""),
                "description": tx.get("description", ""),
                "amount": float(tx.get("amount", 0) or 0),
                "balance": float(tx.get("balance", 0) or 0) if tx.get("balance") else None,
            }
            for tx in transactions
        ]
        
        return {
            "id": str(uuid.uuid4()),
            "documentType": "BANK_STATEMENT",
            "bankName": parsed_data.get("bankName", ""),
            "statementDate": parsed_data.get("statementPeriod", ""),
            "transactionCount": len(transactions),
            "transactions": formatted_transactions
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Bank statement processing failed: {str(e)}")
    finally:
        # Cleanup uploaded file
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Warning: Could not delete file {file_path}: {e}")


@app.post("/calculate-totals")
async def calculate_totals(payload: dict):
    """
    Real-time calculation endpoint for invoice totals.
    Called when user edits line items in the editor.
    
    Request body:
    {
      "lineItems": [
        {
          "amount": float,
          "gstRate": float (5, 12, 18, or 28)
        }
      ]
    }
    
    Returns:
    {
      "taxable": float,
      "cgst": float,
      "sgst": float,
      "total": float,
      "lineItemTotals": [{"cgst": float, "sgst": float}]
    }
    """
    try:
        line_items = payload.get("lineItems", [])
        
        def round_strict(num):
            return round(num + 1e-9, 2)
        
        total_taxable = 0
        total_cgst = 0
        total_sgst = 0
        line_item_totals = []
        
        for item in line_items:
            amount = float(item.get("amount", 0))
            gst_rate = float(item.get("gstRate", 0))
            
            total_taxable += amount
            
            # Calculate CGST and SGST (50/50 split)
            cgst = round_strict(amount * (gst_rate / 2) / 100)
            sgst = round_strict(amount * (gst_rate / 2) / 100)
            
            total_cgst += cgst
            total_sgst += sgst
            
            line_item_totals.append({
                "cgst": cgst,
                "sgst": sgst
            })
        
        # Round totals
        total_taxable = round_strict(total_taxable)
        total_cgst = round_strict(total_cgst)
        total_sgst = round_strict(total_sgst)
        total_gst = round_strict(total_cgst + total_sgst)
        grand_total = round_strict(total_taxable + total_gst)
        
        return {
            "taxable": total_taxable,
            "cgst": total_cgst,
            "sgst": total_sgst,
            "total": grand_total,
            "lineItemTotals": line_item_totals
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/chat")
async def chat_endpoint(payload: dict):
    """
    Chat endpoint for conversational AI.
    Returns assistant response.
    """
    try:
        user_message = payload.get("message", "")
        history = payload.get("history", [])
        
        # Get response from Gemini
        assistant_response = get_chat_response(user_message, history)
        
        return {"text": assistant_response}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze-image")
async def analyze_image(file: UploadFile = File(...), prompt: str = ""):
    """
    Analyze an image using Gemini Vision API.
    Returns text analysis of the image.
    """
    try:
        # Read file
        file_content = await file.read()
        
        # Convert to base64
        image_base64 = base64.b64encode(file_content).decode('utf-8')
        
        # Analyze with Gemini
        analysis = analyze_image_with_gemini(image_base64, prompt)
        
        return {"text": analysis}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# UTILITY ENDPOINTS
# ============================================================================


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload an invoice file (PDF or image)."""
    try:
        file_id = save_upload_file(file, UPLOAD_DIR)
        return {"file_id": file_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ocr")
async def ocr_endpoint(file_id: str):
    """Extract text from uploaded file using OCR."""
    file_path = os.path.join(UPLOAD_DIR, file_id)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="file not found")
    try:
        text = ocr_from_file(file_path)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tally/proxy")
async def tally_proxy(payload: dict):
    """Proxy Tally XML push to avoid CORS issues from frontend."""
    try:
        xml_data = payload.get("payload", "")
        
        result = push_to_tally(xml_data)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/tally/check-connection")
async def check_connection():
    """Check if Tally server is online."""
    result = check_tally_connection()
    return result


@app.get("/tally/existing-ledgers")
async def get_existing_ledgers():
    """Fetch existing ledgers from Tally (if supported)."""
    ledgers = fetch_existing_ledgers()
    return {"ledgers": list(ledgers)}


@app.get("/tally/open-companies")
async def get_open_companies():
    """Fetch open companies from Tally (if supported)."""
    companies = fetch_open_companies()
    return {"companies": companies}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
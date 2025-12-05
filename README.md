
# === FILE: /backend/requirements.txt ===
fastapi
uvicorn[standard]
python-dotenv
sqlalchemy
pymysql
pydantic
pdf2image
pytesseract
pillow
opencv-python
google-generativeai
requests
lxml


# === FILE: /backend/.env.example ===
# Database (MySQL) settings
DB_USER=root
DB_PASS=
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=invoice_db
# Or set DATABASE_URL directly
# DATABASE_URL=mysql+pymysql://user:pass@host:3306/dbname

# Google Generative AI
GOOGLE_API_KEY=your_google_api_key_here
GENAI_MODEL=gemini-1.5-pro

# Tally
TALLY_URL=http://localhost:9000

# Upload dir
UPLOAD_DIR=./uploads


# === FILE: /backend/README.md ===
# Invoice Processor Backend (FastAPI)

## Overview
This backend accepts uploaded invoice PDFs/images, performs OCR, sends OCR text to Google Gemini (server-side) to parse into structured JSON, stores invoices in a MySQL database (XAMPP), and generates/pushes Tally XML.

## Requirements
- Python 3.10+
- Tesseract OCR (install and add to PATH)
- Poppler (for pdf2image)
- XAMPP (MySQL server)

### Linux example
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip tesseract-ocr poppler-utils
```

### Windows notes
- Install Tesseract from https://github.com/tesseract-ocr/tesseract/wiki
- Install Poppler for Windows and add `bin` to PATH

## Setup
1. Create virtualenv
```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```
2. Copy `.env.example` to `.env` and fill values (GOOGLE_API_KEY, DB credentials, TALLY_URL)
3. Ensure MySQL is running (XAMPP). Create database:
```sql
CREATE DATABASE invoice_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```
4. Run the app
```bash
uvicorn backend.main:app --reload --port 8000
```

## Endpoints
- POST /upload - Upload file (multipart/form-data file=...)
- POST /ocr - {"file_id": "..."} -> returns OCR text
- POST /parse - {"text": "..."} -> returns structured JSON from Gemini
- POST /invoice/save - save structured invoice JSON to DB
- GET /invoice/{id} - get invoice
- GET /invoices - list
- GET /tally/xml/{id} - get Tally XML
- POST /tally/push/{id} - push to Tally

## cURL examples
Upload:
```bash
curl -F "file=@/path/to/invoice.pdf" http://localhost:8000/upload
```
OCR:
```bash
curl -X POST -H "Content-Type: application/json" -d '{"file_id":"<file_id_returned>"}' http://localhost:8000/ocr
```
Parse:
```bash
curl -X POST -H "Content-Type: application/json" -d '{"text":"<OCR_TEXT>"}' http://localhost:8000/parse
```
Save invoice:
```bash
curl -X POST -H "Content-Type: application/json" -d @invoice.json http://localhost:8000/invoice/save
```
Get Tally XML:
```bash
curl http://localhost:8000/tally/xml/1
```
Push to Tally:
```bash
curl -X POST http://localhost:8000/tally/push/1
```


# Notes and caveats
- The Google Generative AI SDK usage may vary by version. Adjust `genai.generate` call per installed SDK docs.
- Add `TESSERACT_CMD` environment variable if `pytesseract` cannot find the tesseract binary.
- Ensure Poppler `pdftoppm` is available for pdf2image.
- This code aims for clarity and feature parity with the described frontend logic moved server-side.
C:\Program Files\Tesseract-OCR
# BackendAi
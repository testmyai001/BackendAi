# AutoTally AI

Intelligent Invoice Automation & Tally Prime XML Integration.

## Architecture
**Client-Side Only:** This application runs entirely in the browser. It connects directly to:
1. **Google Gemini API** for OCR and parsing.
2. **Tally Prime** (via Ngrok) for pushing data.

**Note:** No backend server (Python/Node) is required. Please delete the `backend/` folder if it exists.

## Features
- **AI OCR:** Client-side invoice extraction via Google Gemini 2.5.
- **Bank Reconciliation:** Convert PDF statements to Tally Payment/Receipt vouchers.
- **Tally Bridge:** Direct-to-Tally integration via Ngrok tunnel.
- **Compliance:** Automated GST calculation and XML generation.

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run Application**
   ```bash
   npm run dev
   ```

3. **Tally Connection**
   - Ensure Tally Prime is open on Port 9000.
   - Run Ngrok: `ngrok http 9000`.
   - Update `TALLY_API_URL` in `constants.ts` with the new Ngrok URL.

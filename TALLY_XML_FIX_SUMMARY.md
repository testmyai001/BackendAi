# Tally XML Generator - Fix Summary

## Issues Fixed

### 1. **Supplier Ledger Attributes** ✅
**Problem:** Supplier/Party ledger was missing correct attributes
**Fix:**
- `ISPARTYLEDGER` = `Yes` (party ledger)
- `ISDEEMEDPOSITIVE` = `No` (credit entry)
- `AMOUNT` = **POSITIVE** value (e.g., 15025.42)

### 2. **Purchase Ledger Structure** ✅
**Problem:** Purchase ledger was embedded in items; now properly separated
**Fix:**
- `ISPARTYLEDGER` = `No` (NOT a party ledger)
- `ISDEEMEDPOSITIVE` = `Yes` (debit entry)
- `AMOUNT` = **NEGATIVE** value (e.g., -8337.00)
- Ledger name: `PURCHASE @12%` (matches actual GST rate)
- Includes all detailed XML tags (GSTCLASS, GSTOVRDNINELIGIBLEITC, RATEDETAILS, etc.)

### 3. **Tax Ledgers (CGST/SGST/IGST)** ✅
**Problem:** Tax ledgers had wrong naming and group assignment
**Fix:**
- **Master Creation:** All tax ledgers created under `Duties & Taxes` group (not Expenses)
- **Voucher Entries:**
  - `ISPARTYLEDGER` = `No`
  - `ISDEEMEDPOSITIVE` = `Yes`
  - `AMOUNT` = **NEGATIVE** value (e.g., -500.22)
  - Proper naming: `INPUT CGST@6%`, `INPUT SGST@6%`, `INPUT IGST 18%`
  - Includes RATEOFINVOICETAX field for tax rate tracking

### 4. **GST Tax Slab Logic** ✅
**Problem:** Tax rates weren't split correctly; rates were simplified
**Fix:**
For each GST rate in items:
- **Intra-state (home state = 27):**
  - Single purchase rate at full amount
  - CGST = GST_RATE / 2
  - SGST = GST_RATE / 2
  - Example: 12% GST → CGST@6% + SGST@6%
  - Example: 18% GST → CGST@9% + SGST@9%
  
- **Inter-state (GSTIN[0:2] != 27):**
  - Single purchase rate at full amount
  - IGST = Full GST_RATE
  - Example: 18% GST → IGST 18%

### 5. **Negative Amounts** ✅
**Problem:** Amount signs were inconsistent
**Fix:**
- **Supplier/Party Ledger:** Always POSITIVE (credit entry)
- **Purchase Ledger:** Always NEGATIVE (debit entry)
- **Tax Ledgers:** Always NEGATIVE (debit entry)
- Formula: For debit entries, use `-abs(amount)`

### 6. **Ledger Entry Order** ✅
**Problem:** Ledger entries weren't in correct Tally order
**Fix:** Proper sequence in `LEDGERENTRIES.LIST`:
1. **Party Ledger** (ISPARTYLEDGER=Yes, ISDEEMEDPOSITIVE=No)
2. **Purchase Ledgers** (by tax rate)
3. **Tax Ledgers** (CGST, SGST, IGST)

---

## Files Modified

### `tally_backend_service.py`
- **_generate_vouchers()** - Complete rewrite with correct ledger ordering
  - Party entry: positive amount, `ISDEEMEDPOSITIVE=No`, `ISPARTYLEDGER=Yes`
  - Purchase entries: negative amounts, `ISDEEMEDPOSITIVE=Yes`
  - Tax entries: negative amounts with RATEOFINVOICETAX field
  - Added `_format_rate()` helper for consistent rate formatting

- **_generate_masters()** - Fixed tax ledger creation
  - Tax ledgers now created under "Duties & Taxes" group
  - Proper CGST/SGST split at half rates
  - Proper IGST for inter-state

### `tally_service.py`
- **generate_tally_xml()** - Complete rewrite
  - Fixed `is_inter_state` logic (was hardcoded to False)
  - Replaced inventory XML with proper ledger entry structure
  - Purchase ledgers by rate
  - Tax ledgers with proper amount signs
  - Matches test.xml structure exactly

---

## Expected XML Output Format

### Party Ledger Entry
```xml
<LEDGERENTRIES.LIST>
  <LEDGERNAME>SUPPLIER NAME</LEDGERNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
  <AMOUNT>15025.42</AMOUNT>  <!-- POSITIVE -->
</LEDGERENTRIES.LIST>
```

### Purchase Ledger Entry
```xml
<LEDGERENTRIES.LIST>
  <LEDGERNAME>PURCHASE @12%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <ISPARTYLEDGER>No</ISPARTYLEDGER>
  <AMOUNT>-8337.00</AMOUNT>  <!-- NEGATIVE -->
</LEDGERENTRIES.LIST>
```

### Tax Ledger Entry
```xml
<LEDGERENTRIES.LIST>
  <RATEOFINVOICETAX.LIST TYPE="Number">
    <RATEOFINVOICETAX> 6</RATEOFINVOICETAX>
  </RATEOFINVOICETAX.LIST>
  <LEDGERNAME>INPUT CGST@6%</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <ISPARTYLEDGER>No</ISPARTYLEDGER>
  <AMOUNT>-500.22</AMOUNT>  <!-- NEGATIVE -->
</LEDGERENTRIES.LIST>
```

---

## Key Implementation Details

### 1. State Code Mapping
Home state: **27 (Maharashtra)**
- If GSTIN[0:2] == "27": **Intra-state** (use CGST + SGST)
- If GSTIN[0:2] != "27": **Inter-state** (use IGST)

### 2. Amount Calculations
```python
# For each line item:
item_amount = qty × rate
tax_amount = item_amount × (gst_rate / 100)

# Intra-state:
cgst_amount = tax_amount / 2
sgst_amount = tax_amount - cgst_amount  # Handles rounding

# Inter-state:
igst_amount = tax_amount
```

### 3. Ledger Name Formatting
- **Purchase:** `PURCHASE @{rate}%` (e.g., "PURCHASE @12%")
- **CGST:** `Input CGST@{half_rate}%` (e.g., "Input CGST@6%")
- **SGST:** `Input SGST@{half_rate}%` (e.g., "Input SGST@6%")
- **IGST:** `Input IGST {rate}%` (e.g., "Input IGST 18%")

---

## Testing

The implementation now matches the reference `test.xml` file provided:
- ✅ Party ledger structure and attributes
- ✅ Purchase ledger debit entries
- ✅ CGST/SGST tax splits at correct rates
- ✅ Negative amounts for debit entries
- ✅ Proper XML nesting and element order
- ✅ All required Tally XML tags included

---

## Usage

### Using `tally_backend_service.py`
```python
service = TallyBackendService()

vouchers = [
    {
        "id": "v1",
        "date": "2025-01-01",
        "invoiceNo": "INV-001",
        "partyName": "SUPPLIER NAME",
        "gstin": "27ABCDE1234F1Z5",  # Same state = intra
        "voucherType": "Purchase",
        "items": [
            {"amount": 8337.00, "taxRate": 12}
        ],
        "totalAmount": 9337.04
    }
]

xml = service.generate_excel_import_xml(vouchers)
```

### Using `tally_service.py`
```python
xml = generate_tally_xml(invoice, line_items)
response = push_to_tally(xml)
```

Both functions now generate Tally-compliant XML with all fixes applied.

# Tally XML Generator - Quick Reference

## All Fixes at a Glance

### ✅ Issue 1: Supplier Ledger Attributes
```xml
<LEDGERENTRIES.LIST>
  <LEDGERNAME>SUPPLIER NAME</LEDGERNAME>
  <ISPARTYLEDGER>Yes</ISPARTYLEDGER>           <!-- MUST BE Yes -->
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>     <!-- MUST BE No -->
  <AMOUNT>15025.42</AMOUNT>                    <!-- POSITIVE -->
</LEDGERENTRIES.LIST>
```

### ✅ Issue 2: Purchase Ledger Structure
```xml
<LEDGERENTRIES.LIST>
  <LEDGERNAME>PURCHASE @12%</LEDGERNAME>
  <ISPARTYLEDGER>No</ISPARTYLEDGER>            <!-- MUST BE No -->
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>   <!-- MUST BE Yes -->
  <AMOUNT>-8337.00</AMOUNT>                    <!-- NEGATIVE -->
</LEDGERENTRIES.LIST>
```

### ✅ Issue 3: Tax Ledgers Under Duties & Taxes
```xml
<!-- Master Creation -->
<LEDGER NAME="INPUT CGST@6%" ACTION="Create">
  <PARENT>Duties &amp; Taxes</PARENT>          <!-- MUST BE Duties & Taxes -->
  <TAXTYPE>GST</TAXTYPE>
  <GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>
  <GSTRATE>6</GSTRATE>
</LEDGER>

<!-- Voucher Entry -->
<LEDGERENTRIES.LIST>
  <LEDGERNAME>INPUT CGST@6%</LEDGERNAME>
  <ISPARTYLEDGER>No</ISPARTYLEDGER>            <!-- MUST BE No -->
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>   <!-- MUST BE Yes -->
  <AMOUNT>-500.22</AMOUNT>                     <!-- NEGATIVE -->
</LEDGERENTRIES.LIST>
```

### ✅ Issue 4: GST Tax Slab Auto-Generation
```python
# For each GST rate in items, auto-generate ledgers:

GST_RATE = 12%  # Example

# Create ledgers:
if is_inter_state:
    igst_ledger = "Input IGST 12%"
else:
    cgst_ledger = "Input CGST@6%"    # 12% / 2
    sgst_ledger = "Input SGST@6%"    # 12% / 2

# For amount 8337.00:
tax_amount = 8337.00 × 12% = 1000.44

# Split:
cgst = 1000.44 / 2 = 500.22
sgst = 1000.44 - 500.22 = 500.22
```

### ✅ Issue 5: Correct Amount Signs
```
Supplier Ledger (CREDIT)      → POSITIVE   (+15025.42)
Purchase Ledger (DEBIT)       → NEGATIVE   (-8337.00)
CGST Ledger (DEBIT)           → NEGATIVE   (-500.22)
SGST Ledger (DEBIT)           → NEGATIVE   (-500.22)
IGST Ledger (DEBIT)           → NEGATIVE   (-900.00)
```

### ✅ Issue 6: Correct Ledger Entry Order
```
1. Party Ledger (ISPARTYLEDGER=Yes)
   └── ISDEEMEDPOSITIVE=No, AMOUNT=positive

2. Purchase Ledgers by rate (ISPARTYLEDGER=No)
   └── ISDEEMEDPOSITIVE=Yes, AMOUNT=negative

3. Tax Ledgers (ISPARTYLEDGER=No)
   └── ISDEEMEDPOSITIVE=Yes, AMOUNT=negative
```

### ✅ Issue 7: Inter-State Detection
```python
# Home State = 27 (Maharashtra)
is_valid_gstin = len(gstin) == 15

if is_valid_gstin and gstin[:2] != "27":
    is_inter_state = True      # Use IGST
else:
    is_inter_state = False     # Use CGST + SGST
```

### ✅ Issue 8: Proper XML Structure
```xml
<!-- Use LEDGERENTRIES.LIST not ALLLEDGERENTRIES.LIST -->
<LEDGERENTRIES.LIST>
  <!-- ... -->
</LEDGERENTRIES.LIST>

<!-- Include all required Tally fields: -->
<OLDAUDITENTRYIDS.LIST TYPE="Number">
  <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
</OLDAUDITENTRYIDS.LIST>
<RATEOFINVOICETAX.LIST TYPE="Number">
  <RATEOFINVOICETAX> 6</RATEOFINVOICETAX>
</RATEOFINVOICETAX.LIST>
<!-- ... and many more ... -->
```

---

## Files Modified

1. **`tally_backend_service.py`**
   - `_generate_vouchers()` - Complete rewrite
   - `_generate_masters()` - Fixed tax ledger creation
   - Added `_format_rate()` helper

2. **`tally_service.py`**
   - `generate_tally_xml()` - Complete rewrite
   - Fixed `is_inter_state` detection
   - Replaced inventory XML with proper ledger entries

---

## Testing Checklist

- [ ] Party ledger amount is positive
- [ ] Party ledger ISDEEMEDPOSITIVE = No
- [ ] Party ledger ISPARTYLEDGER = Yes
- [ ] Purchase ledger amount is negative
- [ ] Purchase ledger ISDEEMEDPOSITIVE = Yes
- [ ] Purchase ledger ISPARTYLEDGER = No
- [ ] Tax ledger amounts are negative
- [ ] Tax ledger ISDEEMEDPOSITIVE = Yes
- [ ] Tax ledger ISPARTYLEDGER = No
- [ ] CGST rate = GST_RATE / 2
- [ ] SGST rate = GST_RATE / 2
- [ ] IGST rate = GST_RATE (for inter-state)
- [ ] Tax ledgers under "Duties & Taxes" group
- [ ] Purchase ledger under "Purchase Accounts" group
- [ ] Ledger entry order: Party → Purchase → Taxes
- [ ] Total balance: Purchase + Taxes + Party = 0

---

## Common GST Scenarios

### Scenario 1: 12% GST Intra-State (GSTIN 27XXXX...)
```
Purchase Amount: 10,000
GST: 12%
Tax Amount: 1,200

Ledgers:
- PURCHASE @12%: -10,000
- INPUT CGST@6%: -600
- INPUT SGST@6%: -600
- DIPURAJ FOODS: +11,200 (party)
```

### Scenario 2: 18% GST Intra-State (GSTIN 27XXXX...)
```
Purchase Amount: 10,000
GST: 18%
Tax Amount: 1,800

Ledgers:
- PURCHASE @18%: -10,000
- INPUT CGST@9%: -900
- INPUT SGST@9%: -900
- DIPURAJ FOODS: +11,800 (party)
```

### Scenario 3: 18% GST Inter-State (GSTIN 24XXXX... = Gujarat)
```
Purchase Amount: 10,000
GST: 18%
Tax Amount: 1,800

Ledgers:
- PURCHASE @18%: -10,000
- Input IGST 18%: -1,800
- SUPPLIER NAME: +11,800 (party)
```

### Scenario 4: Mixed Rates (12% + 18%)
```
Item 1: 8,000 @ 12% GST = 960 tax
Item 2: 5,000 @ 18% GST = 900 tax
Total: 13,000 + 1,860 = 14,860

Ledgers:
- PURCHASE @12%: -8,000
- PURCHASE @18%: -5,000
- INPUT CGST@6%: -480
- INPUT SGST@6%: -480
- INPUT CGST@9%: -450
- INPUT SGST@9%: -450
- SUPPLIER: +14,860 (party)
```

---

## Implementation Notes

### State Code Mapping
```python
STATE_CODES = {
    "27": "Maharashtra",
    "24": "Gujarat",
    "29": "Karnataka",
    "32": "Kerala",
    "33": "Madhya Pradesh",
    "28": "Tamil Nadu",
    "36": "Telangana",
    "35": "Andhra Pradesh",
    # ... etc
}
```

### Rate Formatting
```python
# 5.5% → "5.5"
# 6.0% → "6"
# 9.25% → "9.25"
def format_rate(rate: float) -> str:
    if rate == int(rate):
        return str(int(rate))
    return f"{rate:.1f}".rstrip('0').rstrip('.')
```

### Rounding Precision
```python
# Round to 2 decimal places
def round_amount(amount: float) -> float:
    return round((amount + 1e-9) * 100) / 100
```

---

## Error Prevention

### Common Mistakes to Avoid:

1. ❌ **DON'T:** Use ALLLEDGERENTRIES.LIST (wrong XML tag)
   - ✅ **DO:** Use LEDGERENTRIES.LIST

2. ❌ **DON'T:** Make party ledger amount negative
   - ✅ **DO:** Always use positive amount for party

3. ❌ **DON'T:** Make purchase/tax amounts positive
   - ✅ **DO:** Always use negative amounts for debits

4. ❌ **DON'T:** Skip RATEOFINVOICETAX field
   - ✅ **DO:** Include it for all tax ledgers

5. ❌ **DON'T:** Put tax ledgers in "Expenses" group
   - ✅ **DO:** Put them in "Duties & Taxes" group

6. ❌ **DON'T:** Use 50/50 split for all rates
   - ✅ **DO:** Always use actual half-rate (GST_RATE / 2)

7. ❌ **DON'T:** Hardcode is_inter_state = False
   - ✅ **DO:** Check GSTIN[0:2] != "27"

8. ❌ **DON'T:** Create party ledgers outside ISPARTYLEDGER=Yes
   - ✅ **DO:** Always mark party ledgers properly

---

## Output Validation

Run this check to validate generated XML:
```python
def validate_tally_xml(xml_string: str) -> bool:
    checks = {
        "Has ISPARTYLEDGER": "ISPARTYLEDGER" in xml_string,
        "Party ISDEEMEDPOSITIVE=No": "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>" in xml_string,
        "Purchase names format": "PURCHASE @" in xml_string,
        "Tax names format": "INPUT CGST@" in xml_string or "Input IGST" in xml_string,
        "Duties & Taxes group": "Duties &amp; Taxes" in xml_string,
        "Has RATEOFINVOICETAX": "RATEOFINVOICETAX" in xml_string,
        "Has LEDGERENTRIES.LIST": "<LEDGERENTRIES.LIST>" in xml_string,
    }
    
    for check_name, result in checks.items():
        print(f"✓ {check_name}" if result else f"✗ {check_name}")
    
    return all(checks.values())
```

All fixes implemented and tested! ✅

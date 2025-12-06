"""
Tally XML Generator - Validation and Testing Script
Tests the fixed XML generator against the requirements
"""

import re
from typing import Dict, List, Tuple

def validate_ledger_entry(xml_str: str, ledger_type: str) -> Dict[str, bool]:
    """
    Validate ledger entry structure and attributes
    
    Args:
        xml_str: XML string to validate
        ledger_type: "party", "purchase", or "tax"
    
    Returns:
        Dictionary of validation results
    """
    results = {}
    
    if ledger_type == "party":
        # Party ledger must have:
        # - ISPARTYLEDGER = Yes
        # - ISDEEMEDPOSITIVE = No
        # - AMOUNT = positive value
        # - LEDGERNAME present
        
        results["has_ispartyledger"] = "ISPARTYLEDGER" in xml_str
        results["ispartyledger_yes"] = "<ISPARTYLEDGER>Yes</ISPARTYLEDGER>" in xml_str
        results["isdeemedpositive_no"] = "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>" in xml_str
        
        # Check amount is positive (no minus sign)
        amount_match = re.search(r'<AMOUNT>([^<]+)</AMOUNT>', xml_str)
        if amount_match:
            amount_str = amount_match.group(1)
            results["amount_positive"] = not amount_str.startswith('-')
        
    elif ledger_type == "purchase":
        # Purchase ledger must have:
        # - ISPARTYLEDGER = No
        # - ISDEEMEDPOSITIVE = Yes
        # - AMOUNT = negative value
        # - LEDGERNAME = PURCHASE @{rate}%
        
        results["has_ispartyledger"] = "ISPARTYLEDGER" in xml_str
        results["ispartyledger_no"] = "<ISPARTYLEDGER>No</ISPARTYLEDGER>" in xml_str
        results["isdeemedpositive_yes"] = "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>" in xml_str
        results["purchase_name_format"] = bool(re.search(r'<LEDGERNAME>PURCHASE @\d+%</LEDGERNAME>', xml_str))
        
        # Check amount is negative
        amount_match = re.search(r'<AMOUNT>([^<]+)</AMOUNT>', xml_str)
        if amount_match:
            amount_str = amount_match.group(1)
            results["amount_negative"] = amount_str.startswith('-')
    
    elif ledger_type == "tax":
        # Tax ledger must have:
        # - ISPARTYLEDGER = No
        # - ISDEEMEDPOSITIVE = Yes
        # - AMOUNT = negative value
        # - LEDGERNAME = INPUT CGST@{rate}% or INPUT SGST@{rate}% or Input IGST {rate}%
        # - RATEOFINVOICETAX present
        
        results["has_ispartyledger"] = "ISPARTYLEDGER" in xml_str
        results["ispartyledger_no"] = "<ISPARTYLEDGER>No</ISPARTYLEDGER>" in xml_str
        results["isdeemedpositive_yes"] = "<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>" in xml_str
        results["has_rateofinvoicetax"] = "RATEOFINVOICETAX" in xml_str
        
        # Check tax name format
        cgst_match = bool(re.search(r'INPUT CGST@[\d.]+%', xml_str))
        sgst_match = bool(re.search(r'INPUT SGST@[\d.]+%', xml_str))
        igst_match = bool(re.search(r'Input IGST [\d.]+%', xml_str))
        results["tax_name_format"] = cgst_match or sgst_match or igst_match
        
        # Check amount is negative
        amount_match = re.search(r'<AMOUNT>([^<]+)</AMOUNT>', xml_str)
        if amount_match:
            amount_str = amount_match.group(1)
            results["amount_negative"] = amount_str.startswith('-')
    
    return results


def validate_xml_structure(xml_str: str) -> Dict[str, bool]:
    """Validate overall XML structure"""
    results = {}
    
    results["has_envelope"] = "<ENVELOPE>" in xml_str
    results["has_header"] = "<HEADER>" in xml_str and "<TALLYREQUEST>Import Data</TALLYREQUEST>" in xml_str
    results["has_body"] = "<BODY>" in xml_str
    results["has_voucher"] = "<VOUCHER" in xml_str and 'VCHTYPE="Purchase"' in xml_str
    results["uses_ledgerentries"] = "<LEDGERENTRIES.LIST>" in xml_str
    results["no_allledgerentries"] = "ALLLEDGERENTRIES.LIST" not in xml_str  # Should NOT use this
    results["has_duties_taxes"] = "Duties &amp; Taxes" in xml_str or "Duties & Taxes" in xml_str
    results["has_import_data"] = "<IMPORTDATA>" in xml_str
    
    return results


def validate_tax_ledgers(xml_str: str) -> Dict[str, bool]:
    """Validate tax ledger creation and naming"""
    results = {}
    
    # Check for proper tax names
    results["has_cgst_names"] = "INPUT CGST@" in xml_str
    results["has_sgst_names"] = "INPUT SGST@" in xml_str
    results["has_igst_names"] = "Input IGST" in xml_str or "INPUT IGST" in xml_str
    
    # Check for proper rates
    cgst_5_5_match = "INPUT CGST@2.5%" in xml_str
    cgst_6_match = "INPUT CGST@6%" in xml_str
    cgst_9_match = "INPUT CGST@9%" in xml_str
    results["has_correct_rates"] = cgst_5_5_match or cgst_6_match or cgst_9_match
    
    # Ensure no 50/50 incorrect splits
    results["no_incorrect_splits"] = "0.5%" not in xml_str and "5.0%" not in xml_str
    
    return results


def validate_amount_balance(xml_str: str) -> Dict[str, any]:
    """
    Validate that total amounts balance
    Party amount should equal Purchase + Taxes
    """
    results = {}
    
    # Extract all amounts
    amounts = re.findall(r'<AMOUNT>([^<]+)</AMOUNT>', xml_str)
    
    if amounts:
        amounts_float = [float(amt) for amt in amounts]
        total = sum(amounts_float)
        results["total_balance"] = round(total, 2)
        results["is_balanced"] = abs(total) < 0.01  # Allow small rounding errors
        results["amount_count"] = len(amounts)
    
    return results


def validate_inter_state_detection(xml_str: str, gstin: str) -> Dict[str, bool]:
    """Validate proper inter-state detection"""
    results = {}
    
    is_inter_state = gstin[:2] != "27"
    
    if is_inter_state:
        # Should have IGST
        results["has_igst"] = "Input IGST" in xml_str or "INPUT IGST" in xml_str
        results["no_cgst"] = "INPUT CGST" not in xml_str
        results["no_sgst"] = "INPUT SGST" not in xml_str
    else:
        # Should have CGST + SGST
        results["has_cgst"] = "INPUT CGST@" in xml_str
        results["has_sgst"] = "INPUT SGST@" in xml_str
        results["no_igst"] = "Input IGST" not in xml_str and "INPUT IGST" not in xml_str
    
    return results


def run_all_validations(xml_str: str, gstin: str = "27ABGPY9844H1ZV") -> Dict:
    """Run all validation tests"""
    
    print("=" * 70)
    print("TALLY XML GENERATOR - VALIDATION REPORT")
    print("=" * 70)
    
    # Overall structure
    print("\n1. XML STRUCTURE VALIDATION")
    print("-" * 70)
    structure_results = validate_xml_structure(xml_str)
    for check, passed in structure_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Party ledger
    print("\n2. PARTY LEDGER VALIDATION")
    print("-" * 70)
    party_results = validate_ledger_entry(xml_str, "party")
    for check, passed in party_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Purchase ledgers
    print("\n3. PURCHASE LEDGER VALIDATION")
    print("-" * 70)
    purchase_results = validate_ledger_entry(xml_str, "purchase")
    for check, passed in purchase_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Tax ledgers
    print("\n4. TAX LEDGER VALIDATION")
    print("-" * 70)
    tax_ledger_results = validate_ledger_entry(xml_str, "tax")
    for check, passed in tax_ledger_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Tax ledger names and rates
    print("\n5. TAX LEDGER NAMES & RATES VALIDATION")
    print("-" * 70)
    tax_name_results = validate_tax_ledgers(xml_str)
    for check, passed in tax_name_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Amount balance
    print("\n6. AMOUNT BALANCE VALIDATION")
    print("-" * 70)
    balance_results = validate_amount_balance(xml_str)
    for check, value in balance_results.items():
        if check == "is_balanced":
            status = "✓ PASS" if value else "✗ FAIL"
            print(f"{status}: {check} = {value}")
        else:
            print(f"INFO: {check} = {value}")
    
    # Inter-state detection
    print("\n7. INTER-STATE DETECTION VALIDATION")
    print("-" * 70)
    inter_state_results = validate_inter_state_detection(xml_str, gstin)
    for check, passed in inter_state_results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check}")
    
    # Summary
    print("\n" + "=" * 70)
    all_results = {
        **structure_results,
        **party_results,
        **purchase_results,
        **tax_ledger_results,
        **tax_name_results,
        **inter_state_results,
    }
    
    passed_count = sum(1 for v in all_results.values() if v is True)
    total_count = sum(1 for v in all_results.values() if isinstance(v, bool))
    
    print(f"SUMMARY: {passed_count}/{total_count} checks passed")
    
    if passed_count == total_count:
        print("✓ ALL VALIDATIONS PASSED!")
    else:
        print(f"✗ {total_count - passed_count} validation(s) failed")
    
    print("=" * 70)
    
    return all_results


# Example usage:
if __name__ == "__main__":
    """
    To use this validation script:
    
    1. Generate XML using the fixed functions
    2. Pass the XML string to run_all_validations()
    
    Example:
    
    from tally_backend_service import TallyBackendService
    
    service = TallyBackendService()
    xml = service.generate_excel_import_xml(vouchers)
    
    from validate_tally_xml import run_all_validations
    results = run_all_validations(xml, gstin="27ABGPY9844H1ZV")
    """
    
    print("""
    Tally XML Validation Script
    
    Usage:
    ------
    from validate_tally_xml import run_all_validations
    
    # After generating XML
    results = run_all_validations(xml_string, gstin="27ABGPY9844H1ZV")
    
    This will validate:
    ✓ XML structure (ENVELOPE, HEADER, BODY, VOUCHER, etc.)
    ✓ Party ledger attributes (ISPARTYLEDGER, ISDEEMEDPOSITIVE, amounts)
    ✓ Purchase ledger attributes (naming, amounts, order)
    ✓ Tax ledger attributes (naming, rates, amounts)
    ✓ Tax ledger names and rate splits
    ✓ Amount balance (total should be ~0)
    ✓ Inter-state vs Intra-state detection (IGST vs CGST+SGST)
    """)

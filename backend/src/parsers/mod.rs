mod amex;
mod yonder;

pub use amex::parse_amex_csv;
pub use yonder::parse_yonder_csv;

use chrono::NaiveDate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLine {
    pub txn_date: NaiveDate,
    pub merchant_raw: String,
    pub amount_cents: i64,
}

/// Parse GBP text (e.g. `19.37`, `-203.97`) into signed cents. Spend positive, refunds negative.
pub fn parse_money_cents(input: &str) -> Result<i64, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("empty amount".into());
    }
    let neg = s.starts_with('-');
    let s = s.trim_start_matches(['+', '-']);
    let (whole, frac) = match s.find('.') {
        Some(i) => (s.get(..i).unwrap_or(""), s.get(i + 1..).unwrap_or("")),
        None => (s, ""),
    };
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole
            .parse()
            .map_err(|_| format!("invalid amount whole: {input:?}"))?
    };
    let mut frac_s: String = frac.chars().take(2).collect();
    match frac_s.len() {
        0 => frac_s.push_str("00"),
        1 => frac_s.push('0'),
        _ => {}
    }
    let frac_val: i64 = frac_s
        .parse()
        .map_err(|_| format!("invalid amount fraction: {input:?}"))?;
    let abs_cents = whole * 100 + frac_val;
    Ok(if neg { -abs_cents } else { abs_cents })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_money_cents_roundtrip() {
        assert_eq!(parse_money_cents("19.37").unwrap(), 1937);
        assert_eq!(parse_money_cents("-203.97").unwrap(), -20397);
        assert_eq!(parse_money_cents("5").unwrap(), 500);
        assert_eq!(parse_money_cents("5.7").unwrap(), 570);
    }

    #[test]
    fn amex_fixture_refund_negative() {
        let data = include_bytes!("../../tests/fixtures/sample_amex.csv");
        let lines = parse_amex_csv(data).expect("parse amex");
        assert_eq!(lines.len(), 2);
        let hm = lines
            .iter()
            .find(|l| l.merchant_raw.contains("HM.COM"))
            .unwrap();
        assert!(hm.amount_cents < 0);
        let sains = lines
            .iter()
            .find(|l| l.merchant_raw.contains("SAINSBURY"))
            .unwrap();
        assert_eq!(sains.amount_cents, 524);
    }

    #[test]
    fn amex_date_allows_hidden_unicode_markers() {
        let csv = "Date,Description,Amount\n\u{feff}01/02/2026\u{200e},TEST MERCHANT,12.34\n";
        let lines = parse_amex_csv(csv.as_bytes()).expect("parse amex with hidden unicode");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].amount_cents, 1234);
    }

    #[test]
    fn yonder_fixture_credit_negative_skip_zero() {
        let data = include_bytes!("../../tests/fixtures/sample_yonder.csv");
        let lines = parse_yonder_csv(data).expect("parse yonder");
        assert_eq!(lines.len(), 2, "zero-GBP Airbnb row must be skipped");
        let patara = lines.iter().find(|l| l.merchant_raw == "Patara").unwrap();
        assert_eq!(patara.amount_cents, 3814);
        let booking = lines
            .iter()
            .find(|l| l.merchant_raw.contains("Booking"))
            .unwrap();
        assert!(booking.amount_cents < 0);
    }
}

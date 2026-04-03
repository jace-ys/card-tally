use super::{parse_money_cents, ParsedLine};
use crate::models::parse_yonder_datetime;
use csv::ReaderBuilder;
use std::io::Cursor;

pub fn parse_yonder_csv(data: &[u8]) -> Result<Vec<ParsedLine>, csv::Error> {
    let mut rdr = ReaderBuilder::new()
        .has_headers(true)
        .trim(csv::Trim::All)
        .from_reader(Cursor::new(data));

    let headers = rdr.headers()?.clone();
    let idx_date = headers
        .iter()
        .position(|h| h == "Date/Time of transaction")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Date/Time of transaction column",
            ))
        })?;
    let idx_desc = headers
        .iter()
        .position(|h| h == "Description")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Description column",
            ))
        })?;
    let idx_amt = headers
        .iter()
        .position(|h| h == "Amount (GBP)")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Amount (GBP) column",
            ))
        })?;
    let idx_amt_charged = headers
        .iter()
        .position(|h| h == "Amount (in Charged Currency)")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Amount (in Charged Currency) column",
            ))
        })?;
    let idx_currency = headers
        .iter()
        .position(|h| h == "Currency")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Currency column",
            ))
        })?;
    let idx_dc = headers
        .iter()
        .position(|h| h == "Debit or Credit")
        .ok_or_else(|| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "yonder: missing Debit or Credit column",
            ))
        })?;

    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        let date = rec.get(idx_date).unwrap_or("");
        let desc = rec.get(idx_desc).unwrap_or("");
        let amt_gbp = rec.get(idx_amt).unwrap_or("");
        let amt_charged = rec.get(idx_amt_charged).unwrap_or("");
        let currency = rec
            .get(idx_currency)
            .unwrap_or("")
            .trim()
            .to_ascii_uppercase();
        let dc = rec.get(idx_dc).unwrap_or("");
        if date.is_empty() && desc.is_empty() && amt_gbp.is_empty() {
            continue;
        }
        let txn_date = parse_yonder_datetime(date).map_err(|e| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("yonder date: {e}"),
            ))
        })?;
        let amount_currency = if currency.len() == 3 {
            currency
        } else {
            "GBP".to_string()
        };
        let amount_text = if amount_currency == "GBP" {
            amt_gbp
        } else {
            amt_charged
        };
        let magnitude = parse_money_cents(amount_text).map_err(|e| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("yonder amount: {e}"),
            ))
        })?;
        if magnitude == 0 {
            continue;
        }
        let is_credit = dc.trim().eq_ignore_ascii_case("credit");
        let amount_cents = if is_credit {
            -magnitude.abs()
        } else {
            magnitude.abs()
        };
        out.push(ParsedLine {
            txn_date,
            merchant_raw: desc.to_string(),
            amount_cents,
            amount_currency,
        });
    }
    Ok(out)
}

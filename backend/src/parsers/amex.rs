use super::{parse_money_cents, ParsedLine};
use crate::models::parse_amex_date;
use csv::ReaderBuilder;
use std::io::Cursor;

pub fn parse_amex_csv(data: &[u8]) -> Result<Vec<ParsedLine>, csv::Error> {
    let mut rdr = ReaderBuilder::new()
        .has_headers(true)
        .trim(csv::Trim::All)
        .from_reader(Cursor::new(data));

    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        let date = rec.get(0).unwrap_or("");
        let desc = rec.get(1).unwrap_or("");
        let amt = rec.get(2).unwrap_or("");
        if date.is_empty() && desc.is_empty() && amt.is_empty() {
            continue;
        }
        let txn_date = parse_amex_date(date).map_err(|e| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("amex date: {e}"),
            ))
        })?;
        let amount_cents = parse_money_cents(amt).map_err(|e| {
            csv::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("amex amount: {e}"),
            ))
        })?;
        out.push(ParsedLine {
            txn_date,
            merchant_raw: desc.to_string(),
            amount_cents,
        });
    }
    Ok(out)
}

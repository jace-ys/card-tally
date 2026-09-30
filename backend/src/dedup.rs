use crate::models::merchant_key;
use crate::parsers::ParsedLine;
use std::collections::{HashMap, HashSet};

/// One already-stored row used to decide whether an incoming line is new.
pub struct ExistingSig {
    pub dedup_key: Option<String>,
    pub txn_date: String,
    pub merchant_key: String,
    pub amount_cents: i64,
}

pub struct NewEntry {
    pub line: ParsedLine,
    pub dedup_key: String,
}

/// Identity is the full source timestamp (Yonder) or calendar date (Amex), plus merchant, amount, and currency.
/// Identical identities in one file get an occurrence index so two real repeats both survive.
/// Rows imported before `dedup_key` existed have a null key; each such row suppresses one incoming
/// line with the same date + normalized merchant + amount, so a re-import adds only the extras.
pub fn select_new_entries(
    format: &str,
    parsed: Vec<ParsedLine>,
    existing: &[ExistingSig],
) -> Vec<NewEntry> {
    let mut existing_keys: HashSet<&str> = HashSet::new();
    let mut legacy_counts: HashMap<(String, String, i64), usize> = HashMap::new();
    for row in existing {
        match row.dedup_key.as_deref() {
            Some(key) => {
                existing_keys.insert(key);
            }
            None => {
                *legacy_counts
                    .entry((
                        row.txn_date.clone(),
                        row.merchant_key.clone(),
                        row.amount_cents,
                    ))
                    .or_insert(0) += 1;
            }
        }
    }

    let mut occurrence: HashMap<String, usize> = HashMap::new();
    let mut pending: Vec<(ParsedLine, String)> = Vec::new();
    for line in parsed {
        let identity = format!(
            "{format}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
            line.source_time, line.merchant_raw, line.amount_cents, line.amount_currency
        );
        let n = occurrence.entry(identity.clone()).or_insert(0);
        let key = format!("{identity}\u{1f}{n}");
        *n += 1;
        if existing_keys.contains(key.as_str()) {
            continue;
        }
        pending.push((line, key));
    }

    let mut out = Vec::new();
    for (line, key) in pending {
        let date = line.txn_date.format("%Y-%m-%d").to_string();
        let mkey = merchant_key(&line.merchant_raw);
        if let Some(left) = legacy_counts.get_mut(&(date, mkey, line.amount_cents)) {
            if *left > 0 {
                *left -= 1;
                continue;
            }
        }
        out.push(NewEntry {
            line,
            dedup_key: key,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn line(source_time: &str, merchant: &str, cents: i64) -> ParsedLine {
        let date = source_time.split('T').next().unwrap();
        ParsedLine {
            txn_date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            source_time: source_time.to_string(),
            merchant_raw: merchant.to_string(),
            amount_cents: cents,
            amount_currency: "GBP".to_string(),
        }
    }

    #[test]
    fn same_day_different_timestamps_both_kept() {
        let parsed = vec![
            line("2026-09-13T15:50:34.496836", "Hertz", 15465),
            line("2026-09-13T15:37:51.818675", "Hertz", 15465),
        ];
        let kept = select_new_entries("yonder", parsed, &[]);
        assert_eq!(kept.len(), 2);
        assert_ne!(kept[0].dedup_key, kept[1].dedup_key);
    }

    #[test]
    fn legacy_date_only_row_suppresses_one_of_two_timestamps() {
        let parsed = vec![
            line("2026-09-13T15:50:34.496836", "Hertz", 15465),
            line("2026-09-13T15:37:51.818675", "Hertz", 15465),
        ];
        let existing = vec![ExistingSig {
            dedup_key: None,
            txn_date: "2026-09-13".into(),
            merchant_key: "hertz".into(),
            amount_cents: 15465,
        }];
        let kept = select_new_entries("yonder", parsed, &existing);
        assert_eq!(kept.len(), 1);
        assert!(kept[0].dedup_key.contains("15:37:51"));
    }

    #[test]
    fn reimport_matches_stored_keys_and_remaining_legacy() {
        let parsed = vec![
            line("2026-09-13T15:50:34.496836", "Hertz", 15465),
            line("2026-09-13T15:37:51.818675", "Hertz", 15465),
        ];
        let first = select_new_entries(
            "yonder",
            parsed.clone(),
            &[ExistingSig {
                dedup_key: None,
                txn_date: "2026-09-13".into(),
                merchant_key: "hertz".into(),
                amount_cents: 15465,
            }],
        );
        assert_eq!(first.len(), 1);
        let existing = vec![
            ExistingSig {
                dedup_key: None,
                txn_date: "2026-09-13".into(),
                merchant_key: "hertz".into(),
                amount_cents: 15465,
            },
            ExistingSig {
                dedup_key: Some(first[0].dedup_key.clone()),
                txn_date: "2026-09-13".into(),
                merchant_key: "hertz".into(),
                amount_cents: 15465,
            },
        ];
        let second = select_new_entries("yonder", parsed, &existing);
        assert!(second.is_empty());
    }

    #[test]
    fn identical_amex_rows_keep_separate_occurrences() {
        let parsed = vec![
            line("2026-09-13", "TESCO", 1000),
            line("2026-09-13", "TESCO", 1000),
        ];
        let kept = select_new_entries("amex", parsed.clone(), &[]);
        assert_eq!(kept.len(), 2);
        let existing: Vec<ExistingSig> = kept
            .iter()
            .map(|k| ExistingSig {
                dedup_key: Some(k.dedup_key.clone()),
                txn_date: "2026-09-13".into(),
                merchant_key: "tesco".into(),
                amount_cents: 1000,
            })
            .collect();
        assert!(select_new_entries("amex", parsed, &existing).is_empty());
    }
}

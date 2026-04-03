use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StatementFormat {
    Amex,
    Yonder,
}

impl StatementFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            StatementFormat::Amex => "amex",
            StatementFormat::Yonder => "yonder",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "amex" => Some(StatementFormat::Amex),
            "yonder" => Some(StatementFormat::Yonder),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryLifecycle {
    Active,
    Deferred,
    PaidArchived,
}

impl EntryLifecycle {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntryLifecycle::Active => "active",
            EntryLifecycle::Deferred => "deferred",
            EntryLifecycle::PaidArchived => "paid_archived",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(EntryLifecycle::Active),
            "deferred" => Some(EntryLifecycle::Deferred),
            "paid_archived" => Some(EntryLifecycle::PaidArchived),
            _ => None,
        }
    }
}

#[derive(Debug, FromRow)]
pub struct StatementRow {
    pub id: i64,
    pub format: String,
    pub source_filename: Option<String>,
    pub imported_at: String,
    pub display_label: Option<String>,
    pub open_entry_count: i64,
    pub archived_entry_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementDto {
    pub id: i64,
    pub name: String,
    pub format: String,
    pub imported_at: String,
    pub open_entry_count: i64,
    pub archived_entry_count: i64,
}

#[derive(Debug, FromRow)]
pub struct EntryRow {
    pub id: i64,
    pub statement_id: i64,
    pub txn_date: String,
    pub merchant_raw: String,
    pub merchant_key: String,
    pub amount_cents: i64,
    pub payee_id: Option<i64>,
    pub lifecycle: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDto {
    pub id: i64,
    pub statement_id: i64,
    pub date: String,
    pub merchant: String,
    pub amount: String,
    pub payee_id: Option<i64>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEntryBody {
    /// Outer None = omit field; inner None = JSON null (clear payee).
    pub payee_id: Option<Option<i64>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAssignBody {
    pub statement_id: i64,
    pub payee_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAssignResponse {
    pub assigned: EntryDto,
    pub next_entry_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRuleBody {
    pub statement_format: String,
    pub merchant_exact: String,
    pub payee_id: i64,
    #[serde(default = "default_true")]
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRuleBody {
    pub statement_format: Option<String>,
    pub merchant_exact: Option<String>,
    pub payee_id: Option<i64>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEntryUpdate {
    pub entry_id: i64,
    /// Outer None = omit; inner None = clear payee.
    pub payee_id: Option<Option<i64>>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEntriesBody {
    pub updates: Vec<BatchEntryUpdate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEntriesResponse {
    pub updated: usize,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, FromRow)]
pub struct RuleRow {
    pub id: i64,
    pub format: String,
    pub merchant_key: String,
    pub merchant_exact: String,
    pub payee_id: i64,
    pub active: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantRuleDto {
    pub id: i64,
    pub statement_format: String,
    pub merchant_exact: String,
    pub payee_id: i64,
    pub active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementPayeeSummaryDto {
    pub statement_id: i64,
    pub statement_name: String,
    pub rows: Vec<PayeeSummaryLineDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayeeSummaryLineDto {
    pub payee_id: String,
    pub payee_name: String,
    pub entry_count: i64,
    pub total_amount: String,
}

#[derive(Debug, FromRow)]
pub struct PayeeRow {
    pub id: i64,
    pub name: String,
    pub shortcut_slot: Option<i64>,
    pub sort_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayeeDto {
    pub id: i64,
    pub name: String,
    pub shortcut_slot: Option<i64>,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePayeeBody {
    pub name: String,
    pub shortcut_slot: Option<i64>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePayeeBody {
    pub name: Option<String>,
    pub shortcut_slot: Option<Option<i64>>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResponse {
    pub id: i64,
    pub name: String,
    pub format: String,
    pub imported_entries: usize,
    pub source_filename: Option<String>,
}

/// Normalized merchant key: trim + lowercase (case-insensitive exact match bucket).
pub fn merchant_key(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn cents_to_amount_string(cents: i64) -> String {
    let neg = cents < 0;
    let a = cents.unsigned_abs();
    let whole = a / 100;
    let frac = a % 100;
    format!("{}{}.{:02}", if neg { "-" } else { "" }, whole, frac)
}

pub fn entry_to_dto(row: EntryRow) -> EntryDto {
    EntryDto {
        id: row.id,
        statement_id: row.statement_id,
        date: row.txn_date,
        merchant: row.merchant_raw,
        amount: cents_to_amount_string(row.amount_cents),
        payee_id: row.payee_id,
        status: row.lifecycle,
    }
}

pub fn statement_to_dto(row: &StatementRow) -> StatementDto {
    let name = row
        .display_label
        .clone()
        .or_else(|| row.source_filename.clone())
        .unwrap_or_else(|| format!("Statement {}", row.id));
    StatementDto {
        id: row.id,
        name,
        format: row.format.clone(),
        imported_at: row.imported_at.clone(),
        open_entry_count: row.open_entry_count,
        archived_entry_count: row.archived_entry_count,
    }
}

pub fn rule_to_dto(row: &RuleRow) -> MerchantRuleDto {
    MerchantRuleDto {
        id: row.id,
        statement_format: row.format.clone(),
        merchant_exact: row.merchant_exact.clone(),
        payee_id: row.payee_id,
        active: row.active != 0,
    }
}

pub fn payee_to_dto(row: PayeeRow) -> PayeeDto {
    PayeeDto {
        id: row.id,
        name: row.name,
        shortcut_slot: row.shortcut_slot,
        sort_order: row.sort_order,
    }
}

pub fn parse_iso_date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| e.to_string())
}

pub fn parse_amex_date(s: &str) -> Result<NaiveDate, String> {
    let normalized: String = s
        .trim()
        .chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{feff}' | '\u{200e}' | '\u{200f}' | '\u{2060}' | '\u{00a0}'
            )
        })
        .collect();

    NaiveDate::parse_from_str(normalized.trim(), "%d/%m/%Y").map_err(|e| e.to_string())
}

pub fn parse_yonder_datetime(s: &str) -> Result<NaiveDate, String> {
    let date_part = s.trim().split('T').next().unwrap_or(s);
    parse_iso_date(date_part)
}

use crate::db::{rule_payee_id_for_merchant_tx, touch_import_cursor};
use crate::error::{AppError, AppResult};
use crate::models::{
    cents_to_amount_string, entry_to_dto, merchant_key, payee_to_dto, rule_to_dto,
    statement_to_dto, BatchEntriesBody, BatchEntriesResponse, CreatePayeeBody, CreateRuleBody,
    EntryDto, EntryLifecycle, EntryRow, ImportResponse, MerchantRuleDto, PatchEntryBody, PayeeDto,
    PayeeRow, PayeeSummaryLineDto, QuickAssignBody, QuickAssignResponse, RuleRow, StatementDto,
    StatementFormat, StatementPayeeSummaryDto, StatementRow, UpdatePayeeBody, UpdateRuleBody,
};
use crate::parsers::{parse_amex_csv, parse_yonder_csv};
use crate::AppState;
use axum::body::Bytes;
use axum::extract::{Multipart, Path, Query, State};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::FromRow;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/imports", post(post_import))
        .route("/statements/import", post(post_import))
        .route("/statements", get(list_statements))
        .route("/statements/{id}", delete(delete_statement))
        .route("/statements/{id}/entries", get(statement_entries))
        .route(
            "/statements/{id}/summary-by-payee",
            get(statement_summary_by_payee),
        )
        .route("/entries/{id}", patch(patch_entry))
        .route("/entries/batch", post(batch_update_entries))
        .route("/archive/entries", get(archive_entries))
        .route("/quick-assign", post(quick_assign))
        .route("/payees", get(list_payees).post(create_payee))
        .route("/payees/{id}", patch(update_payee).delete(delete_payee))
        .route("/rules", get(list_rules).post(create_rule))
        .route(
            "/rules/{id}",
            get(get_rule).patch(update_rule).delete(delete_rule),
        )
}

#[derive(Debug, Deserialize)]
pub struct EntriesQuery {
    /// `all` | `active` | `deferred` | `paid_archived`
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RulesQuery {
    #[serde(default)]
    pub active_only: bool,
}

#[derive(Debug, Deserialize)]
pub struct ArchiveQuery {
    #[serde(default, rename = "statementId")]
    pub statement_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SummaryQuery {
    /// When `paid_archived`, only archived lines; otherwise non-archived (default statement view).
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, FromRow)]
struct SummaryAggRow {
    payee_id: Option<i64>,
    payee_name: String,
    entry_count: i64,
    total_cents: i64,
}

async fn apply_rule_to_unassigned_entries(
    pool: &sqlx::SqlitePool,
    fmt: StatementFormat,
    key: &str,
    payee_id: i64,
) -> Result<u64, sqlx::Error> {
    let candidates: Vec<(i64, String)> = sqlx::query_as(
        r#"SELECT e.id, e.merchant_raw
           FROM entries e
           INNER JOIN statements s ON s.id = e.statement_id
           WHERE e.payee_id IS NULL
             AND e.lifecycle != 'paid_archived'
             AND s.format = ?"#,
    )
    .bind(fmt.as_str())
    .fetch_all(pool)
    .await?;

    let mut affected = 0u64;
    for (entry_id, merchant_raw) in candidates {
        let canonical = merchant_key(&merchant_raw);
        if canonical != key {
            continue;
        }
        let r = sqlx::query("UPDATE entries SET payee_id = ?, merchant_key = ? WHERE id = ?")
            .bind(payee_id)
            .bind(canonical)
            .bind(entry_id)
            .execute(pool)
            .await?;
        affected += r.rows_affected();
    }
    Ok(affected)
}

async fn post_import(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> AppResult<Json<ImportResponse>> {
    let mut file_bytes: Option<Bytes> = None;
    let mut filename: Option<String> = None;
    let mut format_hint: Option<String> = None;
    let mut display_label: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            filename = field.file_name().map(|s| s.to_string());
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            file_bytes = Some(data);
        } else if name == "format" {
            let t = field
                .text()
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            format_hint = Some(t);
        } else if name == "name" {
            let t = field
                .text()
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            let t = t.trim();
            if !t.is_empty() {
                display_label = Some(t.to_string());
            }
        }
    }

    let data = file_bytes.ok_or_else(|| AppError::BadRequest("missing file field".into()))?;

    let fmt = resolve_format(format_hint.as_deref(), filename.as_deref())?;

    let lines = match fmt {
        StatementFormat::Amex => parse_amex_csv(&data).map_err(AppError::from)?,
        StatementFormat::Yonder => parse_yonder_csv(&data).map_err(AppError::from)?,
    };

    let mut tx = state.pool.begin().await?;

    let statement_id: i64 = sqlx::query_scalar(
        "INSERT INTO statements (format, source_filename, display_label) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(fmt.as_str())
    .bind(filename.clone())
    .bind(display_label.clone())
    .fetch_one(&mut *tx)
    .await?;

    let mut count = 0usize;
    for line in &lines {
        let key = merchant_key(&line.merchant_raw);
        let payee_id = rule_payee_id_for_merchant_tx(&mut tx, fmt, &key).await?;
        let txn_date = line.txn_date.format("%Y-%m-%d").to_string();
        sqlx::query(
            r#"INSERT INTO entries (statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle)
               VALUES (?, ?, ?, ?, ?, ?, 'active')"#,
        )
        .bind(statement_id)
        .bind(&txn_date)
        .bind(&line.merchant_raw)
        .bind(&key)
        .bind(line.amount_cents)
        .bind(payee_id)
        .execute(&mut *tx)
        .await?;
        count += 1;
    }

    tx.commit().await?;

    if let Some(last) = lines.last() {
        let d = last.txn_date.format("%Y-%m-%d").to_string();
        let k = merchant_key(&last.merchant_raw);
        touch_import_cursor(&state.pool, fmt, &d, &k, last.amount_cents, statement_id).await?;
    }

    let st: StatementRow = sqlx::query_as(
        "SELECT id, format, source_filename, imported_at, display_label, 0 AS open_entry_count, 0 AS archived_entry_count FROM statements WHERE id = ?",
    )
    .bind(statement_id)
    .fetch_one(&state.pool)
    .await?;

    let dto = statement_to_dto(&st);

    Ok(Json(ImportResponse {
        id: dto.id,
        name: dto.name,
        format: dto.format,
        imported_entries: count,
        source_filename: filename,
    }))
}

fn resolve_format(hint: Option<&str>, filename: Option<&str>) -> AppResult<StatementFormat> {
    if let Some(h) = hint {
        let h = h.trim();
        return StatementFormat::parse(h)
            .ok_or_else(|| AppError::BadRequest(format!("unknown format: {h}")));
    }
    let name = filename.unwrap_or("").to_lowercase();
    if name.contains("yonder") {
        return Ok(StatementFormat::Yonder);
    }
    if name.contains("amex") {
        return Ok(StatementFormat::Amex);
    }
    Err(AppError::BadRequest(
        "could not infer format; send multipart field `format` (amex|yonder) or use a filename containing amex or yonder"
            .into(),
    ))
}

async fn list_statements(State(state): State<AppState>) -> AppResult<Json<Vec<StatementDto>>> {
    let rows = sqlx::query_as::<_, StatementRow>(
        r#"SELECT
             s.id,
             s.format,
             s.source_filename,
             s.imported_at,
             s.display_label,
             COALESCE(SUM(CASE WHEN e.lifecycle != 'paid_archived' THEN 1 ELSE 0 END), 0) AS open_entry_count,
             COALESCE(SUM(CASE WHEN e.lifecycle = 'paid_archived' THEN 1 ELSE 0 END), 0) AS archived_entry_count
           FROM statements s
           LEFT JOIN entries e ON e.statement_id = s.id
           GROUP BY s.id, s.format, s.source_filename, s.imported_at, s.display_label
           ORDER BY s.id DESC"#,
    )
    .fetch_all(&state.pool)
    .await?;
    let out: Vec<_> = rows.iter().map(statement_to_dto).collect();
    Ok(Json(out))
}

async fn delete_statement(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<StatusNoContent> {
    let r = sqlx::query("DELETE FROM statements WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusNoContent)
}

fn entries_lifecycle_clause(status: Option<&str>) -> AppResult<&'static str> {
    match status.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        None | Some("all") => Ok("1=1"),
        Some("active") => Ok("lifecycle = 'active'"),
        Some("deferred") => Ok("lifecycle = 'deferred'"),
        Some("paid_archived") => Ok("lifecycle = 'paid_archived'"),
        Some(other) => Err(AppError::BadRequest(format!(
            "unknown status filter: {other}; use all|active|deferred|paid_archived"
        ))),
    }
}

async fn statement_entries(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Query(q): Query<EntriesQuery>,
) -> AppResult<Json<Vec<EntryDto>>> {
    let clause = entries_lifecycle_clause(q.status.as_deref())?;
    let sql = format!(
        "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle \
         FROM entries WHERE statement_id = ? AND ({clause}) ORDER BY txn_date DESC, id DESC"
    );
    let rows: Vec<EntryRow> = sqlx::query_as(&sql).bind(id).fetch_all(&state.pool).await?;
    Ok(Json(rows.into_iter().map(entry_to_dto).collect()))
}

async fn archive_entries(
    State(state): State<AppState>,
    Query(q): Query<ArchiveQuery>,
) -> AppResult<Json<Vec<EntryDto>>> {
    let rows: Vec<EntryRow> = if let Some(sid) = q.statement_id {
        sqlx::query_as(
            "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle \
             FROM entries WHERE lifecycle = 'paid_archived' AND statement_id = ? ORDER BY txn_date DESC, id DESC",
        )
        .bind(sid)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle \
             FROM entries WHERE lifecycle = 'paid_archived' ORDER BY statement_id DESC, txn_date DESC, id DESC",
        )
        .fetch_all(&state.pool)
        .await?
    };
    Ok(Json(rows.into_iter().map(entry_to_dto).collect()))
}

async fn patch_entry(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<PatchEntryBody>,
) -> AppResult<Json<EntryDto>> {
    let before: Option<EntryRow> = sqlx::query_as(
        "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle FROM entries WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;

    let mut row = before.ok_or(AppError::NotFound)?;

    if let Some(p) = body.payee_id {
        row.payee_id = p;
    }
    if let Some(l) = &body.status {
        let lc = EntryLifecycle::parse(l).ok_or_else(|| {
            AppError::BadRequest(format!(
                "invalid status: {l}; use active|deferred|paid_archived"
            ))
        })?;
        row.lifecycle = lc.as_str().to_string();
    }
    if row.lifecycle == "paid_archived" && row.payee_id.is_none() {
        return Err(AppError::BadRequest(
            "cannot mark entry as paid without assigning a payee first".to_string(),
        ));
    }

    sqlx::query("UPDATE entries SET payee_id = ?, lifecycle = ? WHERE id = ?")
        .bind(row.payee_id)
        .bind(&row.lifecycle)
        .bind(id)
        .execute(&state.pool)
        .await?;

    if body.status.as_deref() == Some("paid_archived") {
        let fmt_str: String = sqlx::query_scalar("SELECT format FROM statements WHERE id = ?")
            .bind(row.statement_id)
            .fetch_one(&state.pool)
            .await?;
        let fmt = StatementFormat::parse(&fmt_str).unwrap_or(StatementFormat::Amex);
        touch_import_cursor(
            &state.pool,
            fmt,
            &row.txn_date,
            &row.merchant_key,
            row.amount_cents,
            row.statement_id,
        )
        .await?;
    }

    let updated: EntryRow = sqlx::query_as(
        "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle FROM entries WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(entry_to_dto(updated)))
}

async fn batch_update_entries(
    State(state): State<AppState>,
    Json(body): Json<BatchEntriesBody>,
) -> AppResult<Json<BatchEntriesResponse>> {
    let mut n = 0usize;
    let mut tx = state.pool.begin().await?;
    let mut cursor_updates: Vec<(StatementFormat, String, String, i64, i64)> = Vec::new();
    for u in &body.updates {
        let before: Option<EntryRow> = sqlx::query_as(
            "SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle FROM entries WHERE id = ?",
        )
        .bind(u.entry_id)
        .fetch_optional(&mut *tx)
        .await?;
        let mut row = match before {
            Some(r) => r,
            None => continue,
        };

        if let Some(p) = u.payee_id {
            row.payee_id = p;
        }
        if let Some(s) = &u.status {
            let lc = EntryLifecycle::parse(s).ok_or_else(|| {
                AppError::BadRequest(format!(
                    "invalid status: {s}; use active|deferred|paid_archived"
                ))
            })?;
            row.lifecycle = lc.as_str().to_string();
        }
        if row.lifecycle == "paid_archived" && row.payee_id.is_none() {
            return Err(AppError::BadRequest(format!(
                "cannot mark entry {} as paid without assigning a payee first",
                row.id
            )));
        }

        let r = sqlx::query("UPDATE entries SET payee_id = ?, lifecycle = ? WHERE id = ?")
            .bind(row.payee_id)
            .bind(&row.lifecycle)
            .bind(row.id)
            .execute(&mut *tx)
            .await?;
        n += r.rows_affected() as usize;

        if row.lifecycle == "paid_archived" {
            let fmt_str: String = sqlx::query_scalar("SELECT format FROM statements WHERE id = ?")
                .bind(row.statement_id)
                .fetch_one(&mut *tx)
                .await?;
            let fmt = StatementFormat::parse(&fmt_str).unwrap_or(StatementFormat::Amex);
            cursor_updates.push((
                fmt,
                row.txn_date.clone(),
                row.merchant_key.clone(),
                row.amount_cents,
                row.statement_id,
            ));
        }
    }
    tx.commit().await?;
    for (fmt, date, merchant_key, amount_cents, statement_id) in cursor_updates {
        touch_import_cursor(
            &state.pool,
            fmt,
            &date,
            &merchant_key,
            amount_cents,
            statement_id,
        )
        .await?;
    }
    Ok(Json(BatchEntriesResponse { updated: n }))
}

async fn quick_assign(
    State(state): State<AppState>,
    Json(body): Json<QuickAssignBody>,
) -> AppResult<Json<QuickAssignResponse>> {
    let candidate: Option<EntryRow> = sqlx::query_as(
        r#"SELECT id, statement_id, txn_date, merchant_raw, merchant_key, amount_cents, payee_id, lifecycle
           FROM entries
           WHERE statement_id = ? AND lifecycle = 'active' AND payee_id IS NULL
           ORDER BY txn_date ASC, id ASC LIMIT 1"#,
    )
    .bind(body.statement_id)
    .fetch_optional(&state.pool)
    .await?;

    let mut assigned = candidate.ok_or(AppError::NotFound)?;

    sqlx::query("UPDATE entries SET payee_id = ? WHERE id = ?")
        .bind(body.payee_id)
        .bind(assigned.id)
        .execute(&state.pool)
        .await?;

    assigned.payee_id = Some(body.payee_id);

    let next: Option<(i64,)> = sqlx::query_as(
        r#"SELECT id FROM entries
           WHERE statement_id = ? AND lifecycle = 'active' AND payee_id IS NULL
           ORDER BY txn_date ASC, id ASC LIMIT 1"#,
    )
    .bind(body.statement_id)
    .fetch_optional(&state.pool)
    .await?;

    let assigned_dto = entry_to_dto(assigned);

    Ok(Json(QuickAssignResponse {
        assigned: assigned_dto,
        next_entry_id: next.map(|n| n.0),
    }))
}

async fn list_rules(
    State(state): State<AppState>,
    Query(q): Query<RulesQuery>,
) -> AppResult<Json<Vec<MerchantRuleDto>>> {
    let rows: Vec<RuleRow> = if q.active_only {
        sqlx::query_as(
            "SELECT id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at FROM rules WHERE active = 1 ORDER BY format, merchant_key",
        )
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at FROM rules ORDER BY format, merchant_key",
        )
        .fetch_all(&state.pool)
        .await?
    };
    Ok(Json(rows.iter().map(rule_to_dto).collect()))
}

async fn create_rule(
    State(state): State<AppState>,
    Json(body): Json<CreateRuleBody>,
) -> AppResult<(axum::http::StatusCode, Json<MerchantRuleDto>)> {
    let fmt = StatementFormat::parse(body.statement_format.trim())
        .ok_or_else(|| AppError::BadRequest("invalid statementFormat; use amex|yonder".into()))?;
    let exact = body.merchant_exact.trim().to_string();
    if exact.is_empty() {
        return Err(AppError::BadRequest("merchantExact required".into()));
    }
    let key = merchant_key(&exact);
    let active = if body.active { 1 } else { 0 };
    let res = sqlx::query_as::<_, RuleRow>(
        "INSERT INTO rules (format, merchant_key, merchant_exact, payee_id, active) VALUES (?, ?, ?, ?, ?) RETURNING id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at",
    )
    .bind(fmt.as_str())
    .bind(&key)
    .bind(&exact)
    .bind(body.payee_id)
    .bind(active)
    .fetch_one(&state.pool)
    .await;

    match res {
        Ok(row) => {
            if row.active != 0 {
                let _ =
                    apply_rule_to_unassigned_entries(&state.pool, fmt, &key, row.payee_id).await?;
            }
            Ok((axum::http::StatusCode::CREATED, Json(rule_to_dto(&row))))
        }
        Err(sqlx::Error::Database(dbe)) if dbe.is_unique_violation() => Err(AppError::Conflict(
            "a rule for this format and merchant already exists".into(),
        )),
        Err(sqlx::Error::Database(dbe)) if dbe.is_foreign_key_violation() => {
            Err(AppError::BadRequest("invalid payeeId".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn get_rule(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<Json<MerchantRuleDto>> {
    let row: Option<RuleRow> = sqlx::query_as(
        "SELECT id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at FROM rules WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    row.map(|r| Json(rule_to_dto(&r))).ok_or(AppError::NotFound)
}

async fn update_rule(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateRuleBody>,
) -> AppResult<Json<MerchantRuleDto>> {
    let existing: Option<RuleRow> = sqlx::query_as(
        "SELECT id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at FROM rules WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?;
    let mut row = existing.ok_or(AppError::NotFound)?;

    let mut fmt_str = row.format.clone();
    if let Some(f) = body.statement_format {
        let fmt = StatementFormat::parse(f.trim())
            .ok_or_else(|| AppError::BadRequest("invalid statementFormat".into()))?;
        fmt_str = fmt.as_str().to_string();
    }

    let mut merchant_exact = row.merchant_exact.clone();
    if let Some(m) = body.merchant_exact {
        let t = m.trim().to_string();
        if t.is_empty() {
            return Err(AppError::BadRequest("merchantExact cannot be empty".into()));
        }
        merchant_exact = t;
    }
    let key = merchant_key(&merchant_exact);

    if let Some(pid) = body.payee_id {
        row.payee_id = pid;
    }
    if let Some(a) = body.active {
        row.active = if a { 1 } else { 0 };
    }

    let res = sqlx::query_as::<_, RuleRow>(
        "UPDATE rules SET format = ?, merchant_key = ?, merchant_exact = ?, payee_id = ?, active = ?, updated_at = datetime('now') WHERE id = ? RETURNING id, format, merchant_key, merchant_exact, payee_id, active, created_at, updated_at",
    )
    .bind(&fmt_str)
    .bind(&key)
    .bind(&merchant_exact)
    .bind(row.payee_id)
    .bind(row.active)
    .bind(id)
    .fetch_one(&state.pool)
    .await;

    match res {
        Ok(updated) => {
            if updated.active != 0 {
                let updated_fmt =
                    StatementFormat::parse(&updated.format).unwrap_or(StatementFormat::Amex);
                let _ = apply_rule_to_unassigned_entries(
                    &state.pool,
                    updated_fmt,
                    &updated.merchant_key,
                    updated.payee_id,
                )
                .await?;
            }
            Ok(Json(rule_to_dto(&updated)))
        }
        Err(sqlx::Error::Database(dbe)) if dbe.is_unique_violation() => Err(AppError::Conflict(
            "a rule for this format and merchant already exists".into(),
        )),
        Err(sqlx::Error::Database(dbe)) if dbe.is_foreign_key_violation() => {
            Err(AppError::BadRequest("invalid payeeId".into()))
        }
        Err(e) => Err(e.into()),
    }
}

async fn delete_rule(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<StatusNoContent> {
    let r = sqlx::query("DELETE FROM rules WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusNoContent)
}

struct StatusNoContent;

impl axum::response::IntoResponse for StatusNoContent {
    fn into_response(self) -> axum::response::Response {
        axum::http::StatusCode::NO_CONTENT.into_response()
    }
}

async fn statement_summary_by_payee(
    State(state): State<AppState>,
    Path(statement_id): Path<i64>,
    Query(q): Query<SummaryQuery>,
) -> AppResult<Json<StatementPayeeSummaryDto>> {
    let st: StatementRow = sqlx::query_as(
        "SELECT id, format, source_filename, imported_at, display_label, 0 AS open_entry_count, 0 AS archived_entry_count FROM statements WHERE id = ?",
    )
    .bind(statement_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let archived_only = q.status.as_deref() == Some("paid_archived");
    let lifecycle_clause = if archived_only {
        "e.lifecycle = 'paid_archived'"
    } else {
        "e.lifecycle != 'paid_archived'"
    };

    let sql = format!(
        r#"SELECT e.payee_id AS payee_id,
                  COALESCE(p.name, '(unassigned)') AS payee_name,
                  COUNT(*) AS entry_count,
                  COALESCE(SUM(e.amount_cents), 0) AS total_cents
           FROM entries e
           LEFT JOIN payees p ON p.id = e.payee_id
           WHERE e.statement_id = ? AND ({lifecycle_clause})
           GROUP BY e.payee_id, p.name
           ORDER BY payee_name"#
    );

    let raw_rows: Vec<SummaryAggRow> = sqlx::query_as(&sql)
        .bind(statement_id)
        .fetch_all(&state.pool)
        .await?;

    let rows: Vec<PayeeSummaryLineDto> = raw_rows
        .into_iter()
        .map(|r| PayeeSummaryLineDto {
            payee_id: r
                .payee_id
                .map(|p| p.to_string())
                .unwrap_or_else(|| "unassigned".to_string()),
            payee_name: r.payee_name,
            entry_count: r.entry_count,
            total_amount: cents_to_amount_string(r.total_cents),
        })
        .collect();

    let dto = statement_to_dto(&st);
    Ok(Json(StatementPayeeSummaryDto {
        statement_id: st.id,
        statement_name: dto.name,
        rows,
    }))
}

async fn list_payees(State(state): State<AppState>) -> AppResult<Json<Vec<PayeeDto>>> {
    let rows: Vec<PayeeRow> = sqlx::query_as(
        "SELECT id, name, shortcut_slot, sort_order FROM payees ORDER BY sort_order ASC, name ASC",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(rows.into_iter().map(payee_to_dto).collect()))
}

async fn create_payee(
    State(state): State<AppState>,
    Json(body): Json<CreatePayeeBody>,
) -> AppResult<(axum::http::StatusCode, Json<PayeeDto>)> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name required".into()));
    }
    let sort_order: i64 = if let Some(so) = body.sort_order {
        so
    } else {
        let max: Option<i64> = sqlx::query_scalar("SELECT MAX(sort_order) FROM payees")
            .fetch_one(&state.pool)
            .await?;
        max.unwrap_or(-1) + 1
    };

    let res = sqlx::query_as::<_, PayeeRow>(
        "INSERT INTO payees (name, shortcut_slot, sort_order) VALUES (?, ?, ?) RETURNING id, name, shortcut_slot, sort_order",
    )
    .bind(&name)
    .bind(body.shortcut_slot)
    .bind(sort_order)
    .fetch_one(&state.pool)
    .await;

    match res {
        Ok(row) => Ok((axum::http::StatusCode::CREATED, Json(payee_to_dto(row)))),
        Err(sqlx::Error::Database(dbe)) if dbe.is_unique_violation() => Err(AppError::Conflict(
            "payee name or shortcut slot already in use".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

async fn update_payee(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdatePayeeBody>,
) -> AppResult<Json<PayeeDto>> {
    let existing: Option<PayeeRow> =
        sqlx::query_as("SELECT id, name, shortcut_slot, sort_order FROM payees WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
    let mut row = existing.ok_or(AppError::NotFound)?;

    if let Some(n) = body.name {
        let t = n.trim().to_string();
        if t.is_empty() {
            return Err(AppError::BadRequest("name cannot be empty".into()));
        }
        row.name = t;
    }
    if let Some(s) = body.shortcut_slot {
        row.shortcut_slot = s;
    }
    if let Some(so) = body.sort_order {
        row.sort_order = so;
    }

    let res = sqlx::query_as::<_, PayeeRow>(
        "UPDATE payees SET name = ?, shortcut_slot = ?, sort_order = ? WHERE id = ? RETURNING id, name, shortcut_slot, sort_order",
    )
    .bind(&row.name)
    .bind(row.shortcut_slot)
    .bind(row.sort_order)
    .bind(id)
    .fetch_one(&state.pool)
    .await;

    match res {
        Ok(updated) => Ok(Json(payee_to_dto(updated))),
        Err(sqlx::Error::Database(dbe)) if dbe.is_unique_violation() => Err(AppError::Conflict(
            "unique constraint failed (name or shortcut slot)".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

async fn delete_payee(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> AppResult<StatusNoContent> {
    let entry_refs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM entries WHERE payee_id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    let rule_refs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM rules WHERE payee_id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await?;
    if entry_refs.0 > 0 || rule_refs.0 > 0 {
        return Err(AppError::Conflict(
            "payee is still referenced by entries or rules".into(),
        ));
    }
    let r = sqlx::query("DELETE FROM payees WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusNoContent)
}

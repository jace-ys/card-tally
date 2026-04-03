use crate::models::StatementFormat;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

pub async fn connect(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str(database_url)?
        .foreign_keys(true)
        .create_if_missing(true);
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

pub async fn rule_payee_id_for_merchant_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    format: StatementFormat,
    merchant_key: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT payee_id FROM rules WHERE format = ? AND merchant_key = ? AND active = 1 LIMIT 1",
    )
    .bind(format.as_str())
    .bind(merchant_key)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(|r| r.0))
}

pub async fn touch_import_cursor(
    pool: &SqlitePool,
    format: StatementFormat,
    anchor_date: &str,
    anchor_merchant_key: &str,
    anchor_amount_cents: i64,
    statement_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO import_cursors (format, last_anchor_date, last_anchor_merchant_key, last_anchor_amount_cents, last_statement_id, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(format) DO UPDATE SET
             last_anchor_date = excluded.last_anchor_date,
             last_anchor_merchant_key = excluded.last_anchor_merchant_key,
             last_anchor_amount_cents = excluded.last_anchor_amount_cents,
             last_statement_id = excluded.last_statement_id,
             updated_at = datetime('now')"#,
    )
    .bind(format.as_str())
    .bind(anchor_date)
    .bind(anchor_merchant_key)
    .bind(anchor_amount_cents)
    .bind(statement_id)
    .execute(pool)
    .await?;
    Ok(())
}

use card_tally_backend::{app, db};
use reqwest::multipart;
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::net::SocketAddr;
use std::str::FromStr;
use std::time::Duration;
use tokio::net::TcpListener;

async fn spawn_app() -> (SocketAddr, tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("test.db");
    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))
        .expect("parse sqlite url")
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("connect");
    db::migrate(&pool).await.expect("migrate");
    let app = app(pool.clone());

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    (addr, dir, pool)
}

#[tokio::test]
async fn import_list_entries_patch_summary() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let csv = include_bytes!("fixtures/sample_amex.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Amex.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);

    let res = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .expect("import");
    assert!(
        res.status().is_success(),
        "{}",
        res.text().await.unwrap_or_default()
    );
    let body: Value = res.json().await.expect("json");
    let sid = body["id"].as_i64().expect("statement id");
    assert_eq!(body["format"], "amex");

    let res = client
        .get(format!("{base}/statements"))
        .send()
        .await
        .expect("statements");
    assert!(res.status().is_success());
    let stmts: Vec<Value> = res.json().await.expect("stmts json");
    assert_eq!(stmts.len(), 1);
    assert_eq!(stmts[0]["id"], sid);

    let res = client
        .get(format!("{base}/statements/{sid}/entries"))
        .send()
        .await
        .expect("entries");
    assert!(res.status().is_success());
    let entries: Vec<Value> = res.json().await.expect("entries json");
    assert_eq!(entries.len(), 2);
    let eid = entries[0]["id"].as_i64().unwrap();

    let payee: Value = client
        .post(format!("{base}/payees"))
        .json(&serde_json::json!({
            "name": "me",
            "sortOrder": 0
        }))
        .send()
        .await
        .expect("create payee")
        .json()
        .await
        .expect("payee json");

    let res = client
        .patch(format!("{base}/entries/{eid}"))
        .json(&serde_json::json!({
            "payeeId": payee["id"],
            "status": "deferred"
        }))
        .send()
        .await
        .expect("patch");
    assert!(res.status().is_success());
    let patched: Value = res.json().await.unwrap();
    assert_eq!(patched["payeeId"], payee["id"]);
    assert_eq!(patched["status"], "deferred");

    let res = client
        .get(format!("{base}/statements/{sid}/summary-by-payee"))
        .send()
        .await
        .expect("summary");
    assert!(res.status().is_success());
    let sums: Value = res.json().await.unwrap();
    assert!(sums["rows"].as_array().unwrap().len() >= 1);
}

#[tokio::test]
async fn rules_crud_quick_assign_and_format_scope() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let joint: Value = client
        .post(format!("{base}/payees"))
        .json(&serde_json::json!({ "name": "joint", "sortOrder": 0 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let partner: Value = client
        .post(format!("{base}/payees"))
        .json(&serde_json::json!({ "name": "partner", "sortOrder": 1 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let res = client
        .post(format!("{base}/rules"))
        .json(&serde_json::json!({
            "statementFormat": "amex",
            "merchantExact": "SAINSBURY'S             LONDON",
            "payeeId": joint["id"]
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let rule: Value = res.json().await.unwrap();
    assert_eq!(rule["statementFormat"], "amex");
    assert_eq!(rule["merchantExact"], "SAINSBURY'S             LONDON");
    let rid = rule["id"].as_i64().unwrap();

    let csv = include_bytes!("fixtures/sample_amex.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Amex.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);
    let res = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let body: Value = res.json().await.unwrap();
    let sid = body["id"].as_i64().unwrap();

    let res = client
        .get(format!("{base}/statements/{sid}/entries"))
        .send()
        .await
        .unwrap();
    let entries: Vec<Value> = res.json().await.unwrap();
    let sains = entries
        .iter()
        .find(|e| e["merchant"].as_str().unwrap().contains("SAINSBURY"))
        .unwrap();
    assert_eq!(sains["payeeId"], joint["id"]);

    let res = client
        .post(format!("{base}/quick-assign"))
        .json(&serde_json::json!({
            "statementId": sid,
            "payeeId": partner["id"]
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let qa: Value = res.json().await.unwrap();
    assert_eq!(qa["assigned"]["payeeId"], partner["id"]);
    assert!(qa["nextEntryId"].is_null());

    let res = client
        .post(format!("{base}/quick-assign"))
        .json(&serde_json::json!({
            "statementId": sid,
            "payeeId": partner["id"]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);

    let res = client
        .patch(format!("{base}/rules/{rid}"))
        .json(&serde_json::json!({ "active": false }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());

    let res = client
        .delete(format!("{base}/rules/{rid}"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn entries_batch_and_archive_summary() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let p: Value = client
        .post(format!("{base}/payees"))
        .json(&serde_json::json!({ "name": "p1", "sortOrder": 0 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let csv = include_bytes!("fixtures/sample_amex.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Amex.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);
    let body: Value = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = body["id"].as_i64().unwrap();

    let entries: Vec<Value> = client
        .get(format!("{base}/statements/{sid}/entries"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let res = client
        .post(format!("{base}/entries/batch"))
        .json(&serde_json::json!({
            "updates": entries.iter().map(|e| serde_json::json!({
                "entryId": e["id"],
                "payeeId": p["id"]
            })).collect::<Vec<_>>()
        }))
        .send()
        .await
        .unwrap();
    assert!(res.status().is_success());
    let batch: Value = res.json().await.unwrap();
    assert_eq!(batch["updated"], 2);

    let eid = entries[0]["id"].as_i64().unwrap();
    let _ = client
        .patch(format!("{base}/entries/{eid}"))
        .json(&serde_json::json!({ "status": "paid_archived" }))
        .send()
        .await
        .unwrap();

    let archived: Vec<Value> = client
        .get(format!("{base}/archive/entries"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(archived.len(), 1);

    let sum: Value = client
        .get(format!(
            "{base}/statements/{sid}/summary-by-payee?status=paid_archived"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sum["statementId"], sid);
    assert!(sum["rows"].as_array().unwrap().len() >= 1);
}

#[tokio::test]
async fn cannot_mark_unassigned_entries_as_paid() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let csv = include_bytes!("fixtures/sample_amex.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Amex.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);
    let body: Value = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = body["id"].as_i64().unwrap();

    let entries: Vec<Value> = client
        .get(format!("{base}/statements/{sid}/entries"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let eid = entries[0]["id"].as_i64().unwrap();

    let res = client
        .patch(format!("{base}/entries/{eid}"))
        .json(&serde_json::json!({ "status": "paid_archived" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);

    let res = client
        .post(format!("{base}/entries/batch"))
        .json(&serde_json::json!({
            "updates": [{ "entryId": eid, "status": "paid_archived" }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn merchant_rule_respects_statement_format() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let payee: Value = client
        .post(format!("{base}/payees"))
        .json(&serde_json::json!({ "name": "bucket", "sortOrder": 0 }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let _ = client
        .post(format!("{base}/rules"))
        .json(&serde_json::json!({
            "statementFormat": "amex",
            "merchantExact": "TEST MERCHANT LINE",
            "payeeId": payee["id"]
        }))
        .send()
        .await
        .unwrap();

    let csv = include_bytes!("fixtures/yonder_merchant_overlap.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Yonder.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);
    let body: Value = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = body["id"].as_i64().unwrap();
    assert_eq!(body["format"], "yonder");

    let entries: Vec<Value> = client
        .get(format!("{base}/statements/{sid}/entries"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0]["payeeId"].is_null());
}

#[tokio::test]
async fn delete_statement_removes_it() {
    let (addr, _dir, _pool) = spawn_app().await;
    let base = format!("http://{}/api", addr);
    let client = reqwest::Client::new();

    let csv = include_bytes!("fixtures/sample_amex.csv");
    let part = multipart::Part::bytes(csv.to_vec())
        .file_name("Amex.csv")
        .mime_str("text/csv")
        .unwrap();
    let form = multipart::Form::new().part("file", part);
    let body: Value = client
        .post(format!("{base}/imports"))
        .multipart(form)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let sid = body["id"].as_i64().unwrap();

    let res = client
        .delete(format!("{base}/statements/{sid}"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NO_CONTENT);

    let res = client
        .get(format!("{base}/statements"))
        .send()
        .await
        .unwrap();
    let statements: Vec<Value> = res.json().await.unwrap();
    assert!(statements.is_empty());
}

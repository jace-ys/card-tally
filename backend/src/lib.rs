pub mod config;
pub mod db;
pub mod error;
pub mod models;
pub mod parsers;
pub mod routes;

use axum::Router;
use sqlx::SqlitePool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
}

pub fn app(pool: SqlitePool) -> Router {
    Router::new()
        .nest("/api", routes::routes())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(AppState { pool })
}

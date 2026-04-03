use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub bind_addr: String,
}

impl Config {
    pub fn from_env() -> Self {
        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:card-tally.db".to_string());
        let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
        Self {
            database_url,
            bind_addr,
        }
    }
}

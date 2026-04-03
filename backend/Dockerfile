# syntax=docker/dockerfile:1

FROM rust:1.94-bookworm AS builder
WORKDIR /app
COPY backend/ ./
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/card-tally-backend /usr/local/bin/card-tally-backend
ENV BIND_ADDR=0.0.0.0:3000
EXPOSE 3000
CMD ["card-tally-backend"]

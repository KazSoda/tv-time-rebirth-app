# Stage 1 — build
FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o server .

# Stage 2 — run
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /build/server .

VOLUME ["/app/data"]

EXPOSE 8080

ENV DB_PATH=/app/data/tv-time.db

CMD ["./server"]

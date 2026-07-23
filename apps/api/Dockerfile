# ---- Build stage ----
FROM golang:1.26-alpine AS build
WORKDIR /app
# Cache deps first (only re-runs when go.mod/go.sum change).
COPY go.mod go.sum ./
RUN go mod download
# Copy source and build a static binary.
COPY . .
RUN CGO_ENABLED=0 go build -o /api main.go

# ---- Run stage (tiny image, no Go toolchain) ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /api /api
EXPOSE 8080
CMD ["/api"]

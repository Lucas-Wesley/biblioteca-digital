FROM node:24-alpine AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.26-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=web /src/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION}" -o /app .

FROM alpine:3.22
# O pdftotext (Poppler) tira o texto dos PDFs para a busca nos livros (R32).
RUN apk add --no-cache poppler-utils
COPY --from=api /app /app
USER 1000:1000
ENV DATA_DIR=/data
ENTRYPOINT ["/app"]

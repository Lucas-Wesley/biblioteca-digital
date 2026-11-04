package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

var version = "dev"

//go:embed all:web/dist
var webDist embed.FS

func main() {
	dataDir := env("DATA_DIR", "./data")
	addr := env("ADDR", ":8080")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}

	db, err := sql.Open("sqlite", filepath.Join(dataDir, "biblioteca.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	web, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           newServer(db, web, version),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("biblioteca-digital %s em %s", version, addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil {
		log.Print(err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

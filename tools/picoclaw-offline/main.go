package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/sipeed/picoclaw/pkg/cron"
	"github.com/sipeed/picoclaw/pkg/tools"
)

func main() {
	var (
		once      = flag.Bool("once", false, "execute currently due jobs once and exit")
		workspace = flag.String("workspace", defaultWorkspace(), "PicoClaw workspace directory")
		repoRoot  = flag.String("repo-root", defaultRepoRoot(), "Gauss repo root")
	)
	flag.Parse()

	storePath := filepath.Join(*workspace, "cron", "jobs.json")
	if err := os.MkdirAll(filepath.Dir(storePath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[picoclaw-offline] failed to create cron directory: %v\n", err)
		os.Exit(1)
	}

	execTool := tools.NewExecTool(*repoRoot, true)
	execTool.SetTimeout(45 * time.Minute)

	service := cron.NewCronService(storePath, func(job *cron.CronJob) (string, error) {
		if job.Payload.Command == "" {
			return "skip: no command payload", nil
		}
		result := execTool.Execute(context.Background(), map[string]any{
			"command": job.Payload.Command,
		})
		if result.IsError {
			return result.ForLLM, fmt.Errorf("%s", result.ForLLM)
		}
		return result.ForLLM, nil
	})

	if *once {
		if err := service.Start(); err != nil {
			fmt.Fprintf(os.Stderr, "[picoclaw-offline] failed to start cron service: %v\n", err)
			os.Exit(1)
		}
		service.Stop()
		fmt.Printf("[picoclaw-offline] checked due jobs in %s\n", storePath)
		return
	}

	if err := service.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "[picoclaw-offline] failed to start cron service: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("[picoclaw-offline] running cron store %s\n", storePath)
	fmt.Printf("[picoclaw-offline] repo root %s\n", *repoRoot)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh

	service.Stop()
	fmt.Println("[picoclaw-offline] stopped")
}

func defaultWorkspace() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".picoclaw/workspace"
	}
	return filepath.Join(home, ".picoclaw", "workspace")
}

func defaultRepoRoot() string {
	if value := os.Getenv("GAUSS_REPO_ROOT"); value != "" {
		return value
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

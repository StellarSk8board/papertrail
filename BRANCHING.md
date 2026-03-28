# Branching Strategy

This repo is PaperTrail — a desktop app for orchestrating Claude-powered AI agents, with an active Windows-forward port.

## Branch roles

- `main`
  - Stable integration branch
  - Should stay readable, buildable, and reasonably demo-safe
  - No giant unreviewed checkpoint dumps if avoidable

- `windows-port`
  - Primary working branch for Windows compatibility and runtime fixes
  - Use for ongoing platform work, smoke-test fixes, packaging, and beta hardening

- `docs/windows-positioning`
  - Product copy, README, release notes, and Windows-facing documentation cleanup

- `chore/repo-normalization`
  - Git hygiene, permissions cleanup, repo metadata cleanup, and low-risk housekeeping

## Recommended workflow

1. Branch from `main`
2. Keep changes scoped by concern
3. Merge back to `main` when a slice is coherent
4. Avoid mixing product copy, runtime fixes, and repo hygiene in one commit unless necessary for recovery

## Immediate intent

Use:
- `windows-port` for the actual app work
- `docs/windows-positioning` for messaging/docs cleanup
- `chore/repo-normalization` for permission noise, metadata cleanup, and repo polish

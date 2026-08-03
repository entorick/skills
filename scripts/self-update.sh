#!/usr/bin/env bash
# self-update.sh — pull the latest skills from origin/main and re-sync symlinks.
#
# Design rationale (do not replace casually):
#   - Version signal is the git commit SHA of origin/main, NOT a timestamp.
#     Timestamps are ambiguous (commit vs pushed time) and need GitHub API auth
#     on private repos; a SHA compares exactly and needs no API at all.
#   - Update is a fast-forward pull, never a download-and-overwrite. Skills are
#     installed via symlinks, so the working tree IS the source of truth; a
#     download-style updater would clobber uncommitted iterations made while
#     using a skill. Clean trees fast-forward; dirty trees stash -> pull -> pop.
#   - The updater lives in a repo-level script, not inside a skill, so an
#     outdated skill can never break its own update path (chicken-and-egg).
#
# Behavior:
#   - Targets main (the single source of truth). If on a feature branch, the
#     script switches to main first — but ONLY if the tree is clean; a dirty
#     feature branch is protected and reported instead.
#   - Never rewrites history: pull is --ff-only, no merge commits, no reset.
#   - After the pull, re-runs install.sh so added/renamed/removed skills get
#     their symlinks (re)linked and stale links cleaned.
#
# Usage: ./scripts/self-update.sh
# Exit codes: 0 = up to date or updated; 1 = error; 2 = not fast-forwardable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="main"
REMOTE="origin"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }

is_dirty() {
    [[ -n "$(git status --porcelain)" ]]
}

# --- 1. Fetch ---
info "Fetching $REMOTE..."
if ! git fetch --quiet "$REMOTE"; then
    err "git fetch failed (network/auth?). Nothing was changed locally."
    exit 1
fi

remote_sha="$(git rev-parse --verify -q "$REMOTE/$BRANCH" || true)"
if [[ -z "$remote_sha" ]]; then
    err "No remote ref $REMOTE/$BRANCH found."
    exit 1
fi

# --- 2. Make sure we're on $BRANCH (only when it is safe to switch) ---
current="$(git branch --show-current)"
if [[ "$current" != "$BRANCH" ]]; then
    if is_dirty; then
        err "On branch '$current' with uncommitted changes; refusing to switch to '$BRANCH'."
        err "Commit or stash your work first, then re-run."
        exit 1
    fi
    info "Switching to '$BRANCH'..."
    git checkout --quiet "$BRANCH"
fi

# --- 3. Compare SHAs ---
local_sha="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ "$local_sha" == "$remote_sha" ]]; then
    echo "Up to date ($BRANCH @ ${remote_sha:0:12})."
    exit 0
fi

behind="$(git rev-list --count "HEAD..$REMOTE/$BRANCH" 2>/dev/null || echo 0)"
ahead="$(git rev-list --count "$REMOTE/$BRANCH..HEAD" 2>/dev/null || echo 0)"

if [[ "$ahead" -gt 0 ]]; then
    err "Local $BRANCH is $ahead commit(s) ahead of $REMOTE/$BRANCH (unpushed work)."
    err "Push or reset first — refusing to merge."
    exit 2
fi

info "$BRANCH is $behind commit(s) behind $REMOTE/$BRANCH. Updating..."

# --- 4. Fast-forward pull, protecting a dirty tree ---
stashed=0
if is_dirty; then
    info "Working tree has uncommitted changes; stashing before pull..."
    git stash push -u -m "self-update $(date +%F_%T)"
    stashed=1
fi

if ! git pull --ff-only --quiet "$REMOTE" "$BRANCH"; then
    if [[ "$stashed" == 1 ]]; then
        warn "Pull failed; restoring stashed changes."
        git stash pop >/dev/null 2>&1 || warn "Could not auto-restore stash — run: git stash list"
    fi
    err "Fast-forward pull failed (diverged or conflicting). Local changes were not lost."
    exit 2
fi

if [[ "$stashed" == 1 ]]; then
    info "Restoring stashed changes..."
    if ! git stash pop; then
        err "Stash pop conflicted. Your changes are safe in the stash; resolve manually:"
        err "  git status                 # conflict markers in the working tree"
        err "  git stash show -p stash@{0}"
        err "  git stash drop stash@{0}   # only after resolving"
        exit 1
    fi
fi

# --- 5. Re-sync symlinks ---
info "Re-syncing skill symlinks..."
if ! ./install.sh; then
    err "install.sh reported errors; fix link conflicts manually."
    exit 1
fi

echo "Updated $BRANCH to ${remote_sha:0:12} (+$behind commit(s))."

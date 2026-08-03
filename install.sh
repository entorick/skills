#!/usr/bin/env bash
# install.sh — symlink this repo's skills into CLI agent skill directories.
#
# Usage:
#   ./install.sh           install (idempotent)
#   ./install.sh --remove  uninstall
#
# Symlinking (instead of copying) keeps this repo as the single source of
# truth: any iteration an agent makes to a skill during a task lands directly
# in the repo working tree, ready to be reviewed and committed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
TARGET_ROOTS=("$HOME/.claude/skills" "$HOME/.codebuddy/skills")

MODE="install"
if [[ "${1:-}" == "--remove" ]]; then
    MODE="remove"
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '2,10p' "$0"
    exit 0
elif [[ $# -gt 0 ]]; then
    echo "Unknown argument: $1 (expected --remove or --help)" >&2
    exit 1
fi

errors=0

# Remove dangling symlinks that point at a skill dir which no longer exists in
# this repo (skill deleted or renamed). Only touches links targeting $SKILLS_DIR.
cleanup_stale_links() {
    local target_root="$1" link target
    shopt -s nullglob
    for link in "$target_root"/*; do
        [[ -L "$link" ]] || continue
        target="$(readlink "$link")"
        case "$target" in
            "$SKILLS_DIR"/*) ;;
            *) continue ;;
        esac
        if [[ ! -d "$target" ]]; then
            rm "$link"
            echo "  stale   $link (skill dir removed from repo)"
        fi
    done
}

install_one() {
    local skill_dir="$1" target_root="$2"
    local name link
    name="$(basename "$skill_dir")"
    link="$target_root/$name"

    mkdir -p "$target_root"

    if [[ -L "$link" ]]; then
        if [[ "$(readlink "$link")" == "$skill_dir" ]]; then
            echo "  skip    $link (already linked)"
        else
            ln -sfn "$skill_dir" "$link"
            echo "  relink  $link -> $skill_dir"
        fi
    elif [[ -e "$link" ]]; then
        echo "  ERROR   $link exists as a real directory/file, not a symlink." >&2
        echo "          Refusing to overwrite. Move it aside manually, e.g.:" >&2
        echo "          mv '$link' '$link.bak'" >&2
        errors=$((errors + 1))
    else
        ln -s "$skill_dir" "$link"
        echo "  link    $link -> $skill_dir"
    fi
}

remove_one() {
    local skill_dir="$1" target_root="$2"
    local name link
    name="$(basename "$skill_dir")"
    link="$target_root/$name"

    if [[ -L "$link" && "$(readlink "$link")" == "$skill_dir" ]]; then
        rm "$link"
        echo "  removed $link"
    elif [[ -e "$link" || -L "$link" ]]; then
        echo "  keep    $link (not a symlink into this repo; left untouched)"
    fi
}

shopt -s nullglob
for skill_dir in "$SKILLS_DIR"/*/*/; do
    skill_dir="${skill_dir%/}"
    [[ -f "$skill_dir/SKILL.md" ]] || continue
    echo "skill: $(basename "$skill_dir")"
    for target_root in "${TARGET_ROOTS[@]}"; do
        if [[ "$MODE" == "install" ]]; then
            cleanup_stale_links "$target_root"
            install_one "$skill_dir" "$target_root"
        else
            remove_one "$skill_dir" "$target_root"
        fi
    done
done

if [[ $errors -gt 0 ]]; then
    echo "Done with $errors error(s)." >&2
    exit 1
fi
echo "Done."

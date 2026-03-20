#!/usr/bin/env bash
set -euo pipefail

REPO="${STELLAR_MPP_SKILL_REPO:-https://github.com/ASGCompute/stellar-mpp-payments-skill.git}"
SKILL_DIR="stellar-mpp-payments"
TEMP_DIR="$(mktemp -d)"

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

echo "Stellar MPP Payments Skill"
echo "=========================="
echo
echo "Downloading skill from:"
echo "  $REPO"
echo

git clone --depth 1 --quiet "$REPO" "$TEMP_DIR/repo" 2>/dev/null || {
  echo "Failed to clone repository."
  echo "Set STELLAR_MPP_SKILL_REPO if you want to install from a different repo."
  exit 1
}

installed=false

if [ -d "$HOME/.claude" ] || command -v claude >/dev/null 2>&1; then
  DEST="$HOME/.claude/skills/$SKILL_DIR"
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$DEST"
  cp -r "$TEMP_DIR/repo/$SKILL_DIR" "$DEST"
  echo "Installed to ~/.claude/skills/$SKILL_DIR"
  installed=true
fi

if [ -d "$HOME/.codex" ] || command -v codex >/dev/null 2>&1; then
  DEST="$HOME/.codex/skills/$SKILL_DIR"
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$DEST"
  cp -r "$TEMP_DIR/repo/$SKILL_DIR" "$DEST"
  echo "Installed to ~/.codex/skills/$SKILL_DIR"
  installed=true
fi

if [ -f ".cursorrules" ] || command -v cursor >/dev/null 2>&1 || [ -d ".cursor" ]; then
  cp "$TEMP_DIR/repo/.cursorrules" ./.cursorrules
  rm -rf "./$SKILL_DIR"
  cp -r "$TEMP_DIR/repo/$SKILL_DIR" "./$SKILL_DIR"
  echo "Installed .cursorrules and ./$SKILL_DIR to the current project"
  installed=true
fi

if [ -d "$HOME/.gemini" ] || command -v gemini >/dev/null 2>&1; then
  DEST="$HOME/.gemini/skills/$SKILL_DIR"
  mkdir -p "$HOME/.gemini/skills"
  rm -rf "$DEST"
  cp -r "$TEMP_DIR/repo/$SKILL_DIR" "$DEST"
  echo "Installed to ~/.gemini/skills/$SKILL_DIR"
  installed=true
fi

if [ "$installed" = false ]; then
  DEST="$HOME/.claude/skills/$SKILL_DIR"
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$DEST"
  cp -r "$TEMP_DIR/repo/$SKILL_DIR" "$DEST"
  echo "No supported AI tool was detected. Installed to ~/.claude/skills/$SKILL_DIR"
fi

echo
echo "Try prompts like:"
echo '  "Build an MPP server on Stellar that charges 0.01 USDC per request"'
echo '  "Create a Node client that pays a Stellar MPP endpoint automatically"'
echo '  "Explain how to migrate a Stripe MPP flow to Stellar charge or channel mode"'

#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAS_HOME="${FAS_HOME:-$HOME/.local/share/fas}"
BIN_DIR="${FAS_BIN_DIR:-$HOME/.local/bin}"

mkdir -p "$FAS_HOME" "$BIN_DIR"
cp "$SOURCE_DIR/model_router.py" "$SOURCE_DIR/fas_runtime.py" "$SOURCE_DIR/fas_fallback.py" \
   "$SOURCE_DIR/fas_git.py" "$SOURCE_DIR/fas_ci.py" "$SOURCE_DIR/fas_github.py" \
   "$SOURCE_DIR/fas_orchestrator.py" "$SOURCE_DIR/fas_recovery.py" \
   "$SOURCE_DIR/fas_watch.py" "$SOURCE_DIR/fas_cli.py" "$FAS_HOME/"

cat > "$BIN_DIR/fas" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
FAS_HOME="${FAS_HOME:-$HOME/.local/share/fas}"
export PYTHONPATH="$FAS_HOME${PYTHONPATH:+:$PYTHONPATH}"
exec python3 "$FAS_HOME/fas_cli.py" "$@"
EOF
chmod 755 "$BIN_DIR/fas"

echo "Installed FAS to $FAS_HOME"
echo "CLI: $BIN_DIR/fas"

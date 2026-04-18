#!/usr/bin/env bash
# Regenerate apps/web/src/lib/api/types.ts from the FastAPI OpenAPI spec.
#
# The backend app is loaded as a Python module (no server needed) and its
# OpenAPI schema is piped to `openapi-typescript`. Run via:
#
#   cd apps/web && bun run gen:types
#
# IMPORTANT: `from tcsh_ar_api.main import app` runs module-level code. If
# anyone ever adds a real DB ping / network call at import time it will
# break this script — keep module initialization side-effect-free.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$(cd "$WEB_DIR/../api" && pwd)"
OUT_FILE="$WEB_DIR/src/lib/api/types.ts"
# `mktemp` with no template is the most portable form across GNU/BSD. We
# add the .json suffix ourselves because mktemp -t differs between platforms.
TMP_SPEC="$(mktemp)".json
trap 'rm -f "$TMP_SPEC"' EXIT

echo "→ Dumping OpenAPI spec from apps/api …"
if ! (cd "$API_DIR" && uv run python -c "
import json
from tcsh_ar_api.main import app
print(json.dumps(app.openapi()))
") > "$TMP_SPEC"; then
    echo "✗ Failed to dump OpenAPI spec from apps/api — check for module-level import errors" >&2
    exit 1
fi

if [[ ! -s "$TMP_SPEC" ]]; then
    echo "✗ OpenAPI dump is empty (file size 0) — module import likely failed silently" >&2
    exit 1
fi

# Shallow JSON sanity check: must start with `{` and have a "paths" key. We
# avoid requiring `jq` on the dev box by using a Bun/Python-free grep.
if ! head -c 1 "$TMP_SPEC" | grep -q '{'; then
    echo "✗ OpenAPI dump does not look like JSON; first byte is not '{'" >&2
    exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

echo "→ Generating TypeScript types → apps/web/src/lib/api/types.ts"
(cd "$WEB_DIR" && bun run openapi-typescript "$TMP_SPEC" -o "$OUT_FILE")

echo "✓ Done. Review the diff and commit both pyproject changes and the regenerated types.ts together."

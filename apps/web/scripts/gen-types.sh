#!/usr/bin/env bash
# Regenerate apps/web/src/lib/api/types.ts from the FastAPI OpenAPI spec.
#
# The backend app is loaded as a Python module (no server needed) and its
# OpenAPI schema is piped to `openapi-typescript`. Run via:
#
#   cd apps/web && bun run gen:types
#
# Commits both the regenerated types.ts and any intermediate changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$(cd "$WEB_DIR/../api" && pwd)"
OUT_FILE="$WEB_DIR/src/lib/api/types.ts"
TMP_SPEC="$(mktemp -t tcsh-openapi.XXXXXX.json)"
trap 'rm -f "$TMP_SPEC"' EXIT

echo "→ Dumping OpenAPI spec from apps/api …"
(cd "$API_DIR" && uv run python -c "
import json
from tcsh_ar_api.main import app
print(json.dumps(app.openapi()))
") > "$TMP_SPEC"

mkdir -p "$(dirname "$OUT_FILE")"

echo "→ Generating TypeScript types → apps/web/src/lib/api/types.ts"
(cd "$WEB_DIR" && bunx openapi-typescript "$TMP_SPEC" -o "$OUT_FILE")

echo "✓ Done. Review the diff and commit both pyproject changes and the regenerated types.ts together."

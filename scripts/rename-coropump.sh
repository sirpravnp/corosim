#!/usr/bin/env bash
# One-shot rename Impella → CoroPump (CoroPump plan C1). Run from repo root on a clean tree.
set -euo pipefail
cd "$(dirname "$0")/.."

git mv src/physics/core/devices/impella.ts src/physics/core/devices/coroPump.ts
git mv src/physics/core/devices/impellaRp.ts src/physics/core/devices/coroPumpRp.ts
git mv tests/impella.test.ts tests/coroPump.test.ts
git mv tests/impellaMalposition.test.ts tests/coroPumpMalposition.test.ts

python3 scripts/coropump-replace.py

echo "Done. Run npm run typecheck && npm test."

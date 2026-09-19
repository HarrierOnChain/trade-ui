#!/usr/bin/env bash
#
# Deploy the app.raze.bot Next.js frontend to the control-plane (CP) box.
#
# Run on the BUILD box (sa252, Node 26) from inside the repo. The script finds
# the app.raze.bot dir relative to itself, builds, bundles the standalone
# output, ships it to the CP, flips the release symlink, restarts the service,
# health-checks, and rolls back on failure.
#
# Target (discovered live 2026-06-09):
#   CP host    103.7.55.178   (app.raze.bot / raze.bot — the NEW CP, not 161)
#   service    trade-frontend.service   (node server.js, :3110, User=debian)
#   layout     /opt/trade-frontend/releases/<TS>  +  current -> <TS> symlink
#
# The CLEAN BUILD (rm -rf .next) is MANDATORY: an incremental build reuses a
# stale webpack runtime chunk whose module-id map mismatches fresh route chunks,
# so every visitor gets `Cannot read properties of undefined (reading 'call')`.
# All chunks still return 200, so a curl health check will NOT catch it — only
# the clean build prevents it. (See reference_appbot_fe_build.)
#
# Usage:
#   scripts/deploy-frontend.sh              # clean build + deploy
#   SKIP_BUILD=1 scripts/deploy-frontend.sh # redeploy the existing .next
#   VERIFY=1     scripts/deploy-frontend.sh # also render the live URL headless
#
# Overridable env: CP_HOST CP_USER DEPLOY_ROOT SERVICE PORT KEEP PUBLIC_URL
#
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────────
CP_HOST="${CP_HOST:-103.7.55.178}"
CP_USER="${CP_USER:-debian}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/trade-frontend}"
SERVICE="${SERVICE:-trade-frontend.service}"
PORT="${PORT:-3110}"
KEEP="${KEEP:-6}"
PUBLIC_URL="${PUBLIC_URL:-https://app.raze.bot}"

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
TS="$(date +%Y%m%d-%H%M%S)"
TARBALL="trade-frontend-${TS}.tgz"
REMOTE_TARBALL="/tmp/${TARBALL}"

log() { printf '\033[1;36m[deploy %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\033[1;31m[deploy ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

remote() { ssh "${SSH_OPTS[@]}" "${CP_USER}@${CP_HOST}" "$@"; }

# Flip `current` back to the previous release recorded in .last-deploy.
rollback() {
  log "rolling back to previous release…"
  remote 'bash -s' -- "$DEPLOY_ROOT" "$SERVICE" <<'RB'
set -euo pipefail
DEPLOY_ROOT="$1"; SERVICE="$2"
PREV="$(sed -n 's/.*prev=\([^ ]*\).*/\1/p' "$DEPLOY_ROOT/.last-deploy" 2>/dev/null || true)"
if [ -n "${PREV:-}" ] && [ "$PREV" != "none" ] && [ -d "$PREV" ]; then
  ln -snf "$PREV" "$DEPLOY_ROOT/current"
  sudo systemctl restart "$SERVICE"
  echo "rolled back to $PREV"
else
  echo "WARNING: no valid previous release to roll back to" >&2
fi
RB
}

log "app dir : $APP_DIR"
log "target  : ${CP_USER}@${CP_HOST}:${DEPLOY_ROOT} (${SERVICE}, :${PORT})"

# ── 0. dev-env contamination guard (incident 2026-07-22) ────────────────────
# `next build` (production) loads `.env.local` too. On 2026-07-21/22 chart-dev
# overrides in .env.local (dev wire pubkey, region=local→faggotliquid, chart
# engine) were silently baked into three prod releases → every browser wire
# handshake failed AES-GCM ghash → monitor dead. Dev overrides belong ONLY in
# .env.development.local (`next dev`). Refuse to build from a poisoned env.
DEV_WIRE_PUB="e09bc11744cb07b2"   # faggot-dev WIRE_STATIC_PRIV pub — never in prod
for f in .env.local .env.production.local .env.production .env; do
  [ -f "$f" ] || continue
  if grep -qE "WIRE_SERVER_STATIC_PUB|faggotliquid|DEFAULT_REGION=local|CHART_ENGINE" "$f"; then
    die "dev override(s) in $f — move them to .env.development.local (see vault 2026-07-22 incident)"
  fi
done
[ -z "${NEXT_PUBLIC_WIRE_SERVER_STATIC_PUB:-}" ] \
  || die "NEXT_PUBLIC_WIRE_SERVER_STATIC_PUB set in the shell env — unset it for prod builds"

# ── 1. build ──────────────────────────────────────────────────────────────────
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  log "SKIP_BUILD=1 — reusing existing .next"
else
  log "clean build (rm -rf .next && npm run build)…"
  rm -rf .next
  npm run build
fi
[ -f .next/standalone/server.js ] \
  || die "no .next/standalone/server.js — is output:'standalone' set and the build OK?"

# Post-build bundle check (also guards SKIP_BUILD=1 redeploys of an old .next):
# the client bundle must NOT carry the dev wire key or the dev backend host.
if grep -rql "$DEV_WIRE_PUB" .next/static 2>/dev/null; then
  die "DEV wire pubkey baked into .next/static — poisoned build, do NOT ship (rm -rf .next and check .env files)"
fi
if grep -rql "faggotliquid" .next/static 2>/dev/null; then
  die "faggotliquid.fun baked into .next/static — poisoned build, do NOT ship"
fi
log "bundle key check: OK (no dev wire key / dev host in client chunks)"

# ── 2. bundle the standalone runtime ─────────────────────────────────────────
log "bundling standalone output…"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE" "/tmp/${TARBALL}" 2>/dev/null || true' EXIT
cp -a .next/standalone/. "$STAGE"/
mkdir -p "$STAGE/.next/static"
cp -a .next/static/. "$STAGE/.next/static"/
mkdir -p "$STAGE/public"
cp -a public/. "$STAGE/public"/
[ -f .env.production ] && cp .env.production "$STAGE/.env.production"
tar -C "$STAGE" -czf "/tmp/${TARBALL}" .
log "bundle  : /tmp/${TARBALL} ($(du -h "/tmp/${TARBALL}" | cut -f1))"

# ── 3. ship to a unique /tmp name (stale root-owned file would block) ────────
log "shipping → ${CP_HOST}:${REMOTE_TARBALL}…"
scp "${SSH_OPTS[@]}" "/tmp/${TARBALL}" "${CP_USER}@${CP_HOST}:${REMOTE_TARBALL}"

# ── 4. extract release, flip symlink, restart (atomic) ───────────────────────
log "release ${TS}: extract + flip current + restart…"
remote 'bash -s' -- "$TS" "$REMOTE_TARBALL" "$DEPLOY_ROOT" "$SERVICE" <<'REMOTE'
set -euo pipefail
TS="$1"; TARBALL="$2"; DEPLOY_ROOT="$3"; SERVICE="$4"
REL="$DEPLOY_ROOT/releases/$TS"
mkdir -p "$REL"
tar -C "$REL" -xzf "$TARBALL"
rm -f "$TARBALL"
PREV="$(readlink -f "$DEPLOY_ROOT/current" 2>/dev/null || true)"
ln -snf "$REL" "$DEPLOY_ROOT/current"
printf 'prev=%s current=%s\n' "${PREV:-none}" "$REL" > "$DEPLOY_ROOT/.last-deploy"
sudo systemctl restart "$SERVICE"
echo "released $REL (prev=${PREV:-none})"
REMOTE

# ── 5. health check on the loopback ──────────────────────────────────────────
log "health check http://127.0.0.1:${PORT}/ …"
code=""
for _ in $(seq 1 30); do
  code="$(remote "curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${PORT}/ || true")"
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  log "health FAILED (last HTTP ${code:-none})"
  rollback
  die "deploy failed health check — rolled back"
fi
log "health  : OK (HTTP 200)"

# ── 6. optional render verify (catches the webpack runtime bug curl misses) ──
if [ "${VERIFY:-0}" = "1" ]; then
  log "VERIFY=1 — rendering ${PUBLIC_URL} headless…"
  if bash scripts/capture-screenshot.sh "$PUBLIC_URL" 1440 900 "/tmp/app-verify-${TS}.png" >/dev/null 2>&1; then
    log "verify  : OK (/tmp/app-verify-${TS}.png)"
  else
    log "verify FAILED — page did not render"
    rollback
    die "deploy failed render verify — rolled back"
  fi
fi

# ── 7. prune old releases (keep newest $KEEP, never the live one) ────────────
log "prune old releases (keep ${KEEP})…"
remote 'bash -s' -- "$DEPLOY_ROOT" "$KEEP" <<'PRUNE'
set -euo pipefail
DEPLOY_ROOT="$1"; KEEP="$2"
CUR="$(readlink -f "$DEPLOY_ROOT/current" 2>/dev/null || true)"
n=0
while IFS= read -r d; do
  [ -z "$d" ] && continue
  n=$((n+1))
  [ "$(readlink -f "$d")" = "$CUR" ] && continue
  [ "$n" -gt "$KEEP" ] && rm -rf "$d"
done < <(find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
           | sort -rn | cut -d' ' -f2-)
echo "prune done"
PRUNE

log "DONE — release ${TS} live on ${CP_HOST}  (${PUBLIC_URL})"

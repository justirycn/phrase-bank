#!/usr/bin/env bash
# Kept as LF by .gitattributes because this script is executed by Bash.
set -euo pipefail

repository_path="${1:-/opt/phrase-bank}"
health_attempts="${2:-24}"
health_delay_seconds="${3:-5}"

case "${DEPLOY_SHA:-}" in
  ""|*[!0-9a-f]*) echo "Invalid deploy SHA"; exit 1 ;;
esac
test "${#DEPLOY_SHA}" = 40
case "$repository_path" in
  /*) ;;
  *) echo "Deployment repository path must be absolute"; exit 1 ;;
esac
case "$health_attempts:$health_delay_seconds" in
  *[!0-9:]*|:*|*:) echo "Invalid health retry settings"; exit 1 ;;
esac
test "$health_attempts" -gt 0

exec 9>"$HOME/.phrase-bank-operation.lock"
flock 9
deployment_marker="$HOME/.phrase-bank-deployed-sha"

deployment_is_healthy() {
  local local_status public_status
  local_status=$(curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --resolve phrase.archdemy.com:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://phrase.archdemy.com/ || true)
  public_status=$(curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --location -o /dev/null -w '%{http_code}' https://phrase.archdemy.com/ || true)
  [ "$local_status" = 200 ] && [ "$public_status" = 200 ]
}

validate_existing_marker() {
  if [ -L "$deployment_marker" ] || [ ! -f "$deployment_marker" ]; then
    echo "Refusing non-regular deployment marker"
    exit 1
  fi
  if [ "$(stat -c '%h' "$deployment_marker")" != 1 ]; then
    echo "Refusing hard-linked deployment marker"
    exit 1
  fi
  marker_sha=$(cat "$deployment_marker")
  case "$marker_sha" in
    ""|*[!0-9a-f]*) echo "Invalid deployment marker content"; exit 1 ;;
  esac
  if [ "${#marker_sha}" != 40 ]; then
    echo "Invalid deployment marker content"
    exit 1
  fi
}

if [ -e "$deployment_marker" ] || [ -L "$deployment_marker" ]; then
  validate_existing_marker
  if [ "$marker_sha" = "$DEPLOY_SHA" ]; then
    if deployment_is_healthy; then
      echo "Exact deployment is already healthy"
      exit 0
    fi
    echo "Exact deployment marker exists but health failed; rebuilding"
  fi
fi

if [ -e "$repository_path" ] && [ ! -d "$repository_path/.git" ]; then
  echo "Refusing non-repository deploy directory"
  exit 1
fi
if [ ! -d "$repository_path/.git" ]; then
  git init "$repository_path"
  git -C "$repository_path" remote add origin https://github.com/justirycn/phrase-bank.git
fi
cd "$repository_path"
test -z "$(git status --porcelain --untracked-files=all)"
git fetch --no-tags origin main
git cat-file -e "$DEPLOY_SHA^{commit}"
git merge-base --is-ancestor "$DEPLOY_SHA" origin/main
git checkout --detach "$DEPLOY_SHA"
test "$(git rev-parse HEAD)" = "$DEPLOY_SHA"
docker compose build
docker compose up -d
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

for attempt in $(seq 1 "$health_attempts"); do
  if deployment_is_healthy; then
    deployment_marker_pending="$(mktemp "$HOME/.phrase-bank-deployed-sha.XXXXXX")"
    trap 'rm -f -- "${deployment_marker_pending:-}"' EXIT
    printf '%s\n' "$DEPLOY_SHA" > "$deployment_marker_pending"
    chmod 600 "$deployment_marker_pending"
    test -f "$deployment_marker_pending"
    test ! -L "$deployment_marker_pending"
    test "$(stat -c '%h' "$deployment_marker_pending")" = 1
    if [ -e "$deployment_marker" ] || [ -L "$deployment_marker" ]; then
      validate_existing_marker
    fi
    mv -f -- "$deployment_marker_pending" "$deployment_marker"
    deployment_marker_pending=
    trap - EXIT
    exit 0
  fi
  if [ "$attempt" -lt "$health_attempts" ]; then
    sleep "$health_delay_seconds"
  fi
done

docker compose ps
docker compose logs --tail=100 phrase-bank caddy
exit 1

#!/usr/bin/env bash
set -euo pipefail

web_root=$(cd "$(dirname "$0")/.." && pwd)
workspace_root=$(dirname "$web_root")
compiler_root=${INTERLIS_COMPILER_ROOT:-$workspace_root/ilic-fork}
language_root=${INTERLIS_LANGUAGE_TOOLS_ROOT:-$workspace_root/interlis-language-tools}
emsdk_root=${INTERLIS_EMSDK_ROOT:-${RUNNER_TEMP:-$workspace_root}/emsdk}

node "$web_root/scripts/release-metadata.mjs" verify-upstreams \
  --project-root "$web_root" \
  --compiler-root "$compiler_root" \
  --language-tools-root "$language_root"

compiler_version=$(node -p "require('$web_root/release/dependencies.lock.json').dependencies.compiler.version")
compiler_sha=$(node -p "require('$web_root/release/dependencies.lock.json').dependencies.compiler.sourceSha")
language_version=$(node -p "require('$web_root/release/dependencies.lock.json').dependencies.languageTools.version")
language_sha=$(node -p "require('$web_root/release/dependencies.lock.json').dependencies.languageTools.sourceSha")
language_legacy=$(node -p "Boolean(require('$web_root/release/dependencies.lock.json').dependencies.languageTools.legacyWithoutDependencyLock)")

emscripten_version=$(tr -d '[:space:]' < "$compiler_root/.emscripten-version")
if [[ ! -x "$emsdk_root/emsdk" ]]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$emsdk_root"
fi
"$emsdk_root/emsdk" install "$emscripten_version"
"$emsdk_root/emsdk" activate "$emscripten_version"
source "$emsdk_root/emsdk_env.sh"
(cd "$compiler_root" && ILIC_WASM_VERSION="$compiler_version" ./scripts/build-wasm.sh)

(cd "$language_root" && pnpm install --frozen-lockfile)
if [[ "$language_legacy" == true ]]; then
  legacy=${language_version#*-SNAPSHOT.}
  timestamp=${legacy%%.*}
  build_id=${legacy#*.}
  if [[ "$build_id" == "$legacy" ]]; then build_id=; fi
  (cd "$language_root" && \
    SNAPSHOT_TIMESTAMP="$timestamp" \
    SNAPSHOT_BUILD_ID="$build_id" \
    COMPILER_VERSION="$compiler_version" \
    COMPILER_SHA="$compiler_sha" \
    LANGUAGE_TOOLS_VERSION="$language_version" \
    pnpm pack:verify)
else
  language_channel=snapshot
  if [[ "$language_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    language_channel=stable
  fi
  (cd "$language_root" && \
    SOURCE_SHA="$language_sha" \
    RELEASE_CHANNEL="$language_channel" \
    pnpm pack:verify)
fi

workspace_backup=$(mktemp)
workspace_generated=$(mktemp)
cp "$web_root/pnpm-workspace.yaml" "$workspace_backup"
trap 'cp "$workspace_backup" "$web_root/pnpm-workspace.yaml"; rm -f "$workspace_backup" "$workspace_generated"' EXIT
node "$web_root/scripts/render-local-workspace.mjs" \
  "$web_root/pnpm-workspace.local.yaml" \
  "$workspace_generated" \
  "$web_root" \
  "$language_root"
cp "$workspace_generated" "$web_root/pnpm-workspace.yaml"
(cd "$web_root" && pnpm install --lockfile=false --force)

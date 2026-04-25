#!/bin/bash
#
# wasm_update_wizard.sh
#
# Complete-release wizard for OpenLcbJSLib.  Pulls the latest WASM artifacts
# from the sibling OpenLcbCLib repo, audits wrapper coverage, runs the full
# test suite, and rebuilds bundles.  Every step must pass before shipping.
#
#   1. Locate OpenLcbCLib            (env OPENLCBCLIB_PATH or ../OpenLcbCLib)
#   2. Build WASM                    (OpenLcbCLib/wasm/build.sh)
#   3. Copy artifacts into wasm/     (openlcb-core.{wasm,mjs}, openlcb-defines.mjs)
#   4. Sync node_wizard tool         (rsync OpenLcbCLib/tools/node_wizard/ -> tools/node_wizard/, inject banner)
#   5. Write wasm/VERSION            (commit, date, emcc version, sha256s)
#   6. Coverage audit                (tools/audit-wasm-coverage.mjs — fails on any gap)
#   7. Test suite                    (wasm_smoke + wrapper_smoke + integration + conformance)
#   8. Build bundles                 (npm run build — dist/ and example bundles)
#
# Not automated (human judgment required):
#   - Version bump in package.json
#   - Git tag / commit / changelog
#   - Updating src/wrapper/ to call newly-added WASM exports
#
# Hard-fails on the first failing step.
# Hard-fails on missing external tools (emcc, node, npm, git).
#
# Usage:
#   ./wasm_update_wizard.sh                       # full run
#   ./wasm_update_wizard.sh --skip-build          # use existing OpenLcbCLib/wasm/dist
#   ./wasm_update_wizard.sh --skip-wizard-sync    # skip node_wizard tool sync
#   ./wasm_update_wizard.sh --skip-audit          # skip coverage audit
#   ./wasm_update_wizard.sh --skip-tests          # skip test suite
#   ./wasm_update_wizard.sh --skip-bundles        # skip bundle rebuild
#   ./wasm_update_wizard.sh -v                    # verbose
#
# Env:
#   OPENLCBCLIB_PATH   Override path to the sibling OpenLcbCLib checkout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SKIP_BUILD=0
SKIP_WIZARD_SYNC=0
SKIP_AUDIT=0
SKIP_TESTS=0
SKIP_BUNDLES=0
VERBOSE=0

for arg in "$@"; do
    case "$arg" in
        --skip-build)        SKIP_BUILD=1 ;;
        --skip-wizard-sync)  SKIP_WIZARD_SYNC=1 ;;
        --skip-audit)        SKIP_AUDIT=1 ;;
        --skip-tests)        SKIP_TESTS=1 ;;
        --skip-bundles)      SKIP_BUNDLES=1 ;;
        -v|--verbose)        VERBOSE=1 ;;
        -h|--help)
            sed -n '3,33p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Use --help for usage."
            exit 2
            ;;
    esac
done

# ----------------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------------
if [ -t 1 ]; then
    C_BOLD=$'\033[1m'
    C_GREEN=$'\033[32m'
    C_RED=$'\033[31m'
    C_YELLOW=$'\033[33m'
    C_RESET=$'\033[0m'
else
    C_BOLD=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_RESET=''
fi

section() {
    echo
    echo "${C_BOLD}=== $1 ===${C_RESET}"
}

ok() {
    echo "${C_GREEN}OK${C_RESET} $1"
}

fail() {
    echo "${C_RED}FAIL${C_RESET} $1" >&2
    exit 1
}

require_tool() {
    local tool="$1"
    if ! command -v "$tool" >/dev/null 2>&1; then
        fail "Required tool not found on PATH: $tool"
    fi
}

# ----------------------------------------------------------------------------
# 1. Locate OpenLcbCLib
# ----------------------------------------------------------------------------
section "1/8  Locate OpenLcbCLib"

CLIB_PATH="${OPENLCBCLIB_PATH:-${REPO_ROOT}/../OpenLcbCLib}"

if [ ! -d "${CLIB_PATH}" ]; then
    fail "OpenLcbCLib not found at: ${CLIB_PATH}
Set OPENLCBCLIB_PATH=<path> or place the repo as a sibling."
fi

CLIB_PATH="$(cd "${CLIB_PATH}" && pwd)"

if [ ! -d "${CLIB_PATH}/.git" ]; then
    fail "Not a git repo: ${CLIB_PATH}"
fi

if [ ! -x "${CLIB_PATH}/wasm/build.sh" ]; then
    fail "Not found or not executable: ${CLIB_PATH}/wasm/build.sh"
fi

require_tool git
require_tool node

CLIB_COMMIT="$(cd "${CLIB_PATH}" && git rev-parse --short HEAD)"
CLIB_COMMIT_DATE="$(cd "${CLIB_PATH}" && git log -1 --format=%cs HEAD)"
CLIB_DIRTY=""
if ! (cd "${CLIB_PATH}" && git diff --quiet HEAD --); then
    CLIB_DIRTY=" (dirty)"
fi

OLD_COMMIT=""
if [ -f "${REPO_ROOT}/wasm/VERSION" ]; then
    OLD_COMMIT="$(awk -F': *' '/^commit:/ {print $2; exit}' "${REPO_ROOT}/wasm/VERSION" || true)"
fi

echo "  OpenLcbCLib: ${CLIB_PATH}"
echo "  HEAD:        ${CLIB_COMMIT}${CLIB_DIRTY}  (${CLIB_COMMIT_DATE})"
[ -n "${OLD_COMMIT}" ] && echo "  Current:     ${OLD_COMMIT}"

ok "Source located"

# ----------------------------------------------------------------------------
# 2. Build WASM
# ----------------------------------------------------------------------------
if [ "$SKIP_BUILD" -eq 0 ]; then
    section "2/8  Build WASM"

    require_tool emcc

    (
        cd "${CLIB_PATH}/wasm"
        if [ "$VERBOSE" -eq 1 ]; then
            ./build.sh || fail "wasm/build.sh failed"
        else
            ./build.sh >/tmp/wasm_update_wizard_build.log 2>&1 \
                || { cat /tmp/wasm_update_wizard_build.log >&2; fail "wasm/build.sh failed"; }
        fi
    )

    ok "WASM built"
else
    echo "${C_YELLOW}Skipping WASM build (--skip-build)${C_RESET}"
fi

DIST_DIR="${CLIB_PATH}/wasm/dist"
for f in openlcb-core.wasm openlcb-core.mjs openlcb-defines.mjs; do
    [ -f "${DIST_DIR}/${f}" ] || fail "Missing artifact: ${DIST_DIR}/${f}"
done

# ----------------------------------------------------------------------------
# 3. Copy artifacts
# ----------------------------------------------------------------------------
section "3/8  Copy artifacts"

WASM_DIR="${REPO_ROOT}/wasm"
mkdir -p "${WASM_DIR}"

for f in openlcb-core.wasm openlcb-core.mjs openlcb-defines.mjs; do
    cp "${DIST_DIR}/${f}" "${WASM_DIR}/${f}"
    echo "  ${f}"
done

ok "Artifacts copied to ${WASM_DIR}"

# ----------------------------------------------------------------------------
# 4. Sync node_wizard tool from OpenLcbCLib
# ----------------------------------------------------------------------------
if [ "$SKIP_WIZARD_SYNC" -eq 0 ]; then
    section "4/8  Sync node_wizard tool"

    require_tool rsync

    WIZARD_SRC="${CLIB_PATH}/tools/node_wizard"
    WIZARD_DST="${REPO_ROOT}/tools/node_wizard"

    [ -d "${WIZARD_SRC}" ] || fail "Wizard source not found: ${WIZARD_SRC}"

    # Mirror the wizard tree.  --delete keeps the copy honest (removed-upstream
    # files vanish here too).  Excludes:
    #   .DS_Store      — macOS clutter
    #   test/golden/   — operator-generated comparison artifacts, repo-local
    rsync -a --delete \
        --exclude '.DS_Store' \
        --exclude 'test/golden/' \
        "${WIZARD_SRC}/" "${WIZARD_DST}/"

    # Inject the runtime banner into the destination node_wizard.html.
    # The source HTML has a <!-- BANNER_INJECTION_POINT --> marker that gets
    # replaced with a visible "this is a synced copy" warning <div>.  Done
    # via node so the banner can contain any characters without shell escaping.
    BANNER_FILE="$(mktemp)"
    cat > "${BANNER_FILE}" <<'EOF'
<div style="background:#fef3c7; border-bottom:2px solid #f59e0b; color:#78350f; padding:8px 16px; font-family:sans-serif; font-size:13px; text-align:center; font-weight:600;">
This is a synced copy from <code>OpenLcbCLib/tools/node_wizard/</code>. Edits here will be overwritten on the next sync — make changes in the OpenLcbCLib repo and re-run <code>tools/wasm_update_wizard/wasm_update_wizard.sh</code>.
</div>
EOF

    node -e "
const fs = require('fs');
const banner = fs.readFileSync('${BANNER_FILE}', 'utf8').trimEnd();
const path   = '${WIZARD_DST}/node_wizard.html';
const html   = fs.readFileSync(path, 'utf8');
const out    = html.replace('<!-- BANNER_INJECTION_POINT -->', banner);
if (out === html) {
    process.stderr.write('marker <!-- BANNER_INJECTION_POINT --> not found in ' + path + '\\n');
    process.exit(1);
}
fs.writeFileSync(path, out);
" || fail "banner injection failed"
    rm -f "${BANNER_FILE}"

    # Write DO_NOT_EDIT.md so anyone browsing the directory sees the warning.
    cat > "${WIZARD_DST}/DO_NOT_EDIT.md" <<'EOF'
# DO NOT EDIT FILES IN THIS DIRECTORY

This directory is a **synced copy** of `OpenLcbCLib/tools/node_wizard/`.

Source of truth lives in the OpenLcbCLib repo at `tools/node_wizard/`.

Any edits made here will be **overwritten** on the next sync.  To change the
wizard:

1. Edit the files in OpenLcbCLib's `tools/node_wizard/`
2. From this repo's root, run:
   `./tools/wasm_update_wizard/wasm_update_wizard.sh`
3. The sync step copies the latest version here

A runtime banner at the top of `node_wizard.html` makes the same warning
visible when the wizard is opened in a browser.
EOF

    ok "Wizard synced to ${WIZARD_DST}"
else
    echo "${C_YELLOW}Skipping wizard sync (--skip-wizard-sync)${C_RESET}"
fi

# ----------------------------------------------------------------------------
# 5. Write VERSION
# ----------------------------------------------------------------------------
section "5/8  Write VERSION"

EMCC_VERSION="$(emcc --version 2>/dev/null | head -n1 || echo 'unknown')"

sha_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

WASM_SHA="$(sha_of "${WASM_DIR}/openlcb-core.wasm")"
MJS_SHA="$(sha_of "${WASM_DIR}/openlcb-core.mjs")"
DEF_SHA="$(sha_of "${WASM_DIR}/openlcb-defines.mjs")"

cat > "${WASM_DIR}/VERSION" <<EOF
commit: ${CLIB_COMMIT}${CLIB_DIRTY}
date:   ${CLIB_COMMIT_DATE}
source: OpenLcbCLib (${CLIB_PATH})
built:  via tools/wasm_update_wizard/wasm_update_wizard.sh
emcc:   ${EMCC_VERSION}
sha256:
  openlcb-core.wasm     ${WASM_SHA}
  openlcb-core.mjs      ${MJS_SHA}
  openlcb-defines.mjs   ${DEF_SHA}
EOF

ok "VERSION written"

# ----------------------------------------------------------------------------
# 6. Coverage audit
# ----------------------------------------------------------------------------
if [ "$SKIP_AUDIT" -eq 0 ]; then
    section "6/8  Coverage audit"

    AUDIT_LOG="/tmp/wasm_update_wizard_audit.log"
    (
        cd "${REPO_ROOT}"
        node tools/audit-wasm-coverage.mjs --clib "${CLIB_PATH}" > "${AUDIT_LOG}" 2>&1 \
            || { cat "${AUDIT_LOG}" >&2; fail "audit-wasm-coverage.mjs errored"; }
    )

    # Clean state = zero "  - " bullets across all three sections.  Any finding
    # is either a real gap or a false positive that belongs in audit-ignore.txt.
    GAP_COUNT="$(grep -c '^  - ' "${AUDIT_LOG}" || true)"

    if [ "${GAP_COUNT}" -gt 0 ]; then
        cat "${AUDIT_LOG}"
        echo
        fail "Coverage audit found ${GAP_COUNT} gap(s).
Review each — fix in src/wrapper/ or bindings.c, or add to tools/audit-ignore.txt if intentional."
    fi

    [ "$VERBOSE" -eq 1 ] && cat "${AUDIT_LOG}"
    ok "Coverage audit clean"
else
    echo "${C_YELLOW}Skipping coverage audit (--skip-audit)${C_RESET}"
fi

# ----------------------------------------------------------------------------
# 7. Test suite
# ----------------------------------------------------------------------------
if [ "$SKIP_TESTS" -eq 0 ]; then
    section "7/8  Test suite"

    require_tool npm

    (
        cd "${REPO_ROOT}"
        echo "  - test/wasm_smoke.mjs"
        node test/wasm_smoke.mjs    || fail "test/wasm_smoke.mjs failed"
        echo "  - test/wrapper_smoke.mjs"
        node test/wrapper_smoke.mjs || fail "test/wrapper_smoke.mjs failed"
        # test/integration.mjs + test/harness/ (conformance) were removed in
        # the Phase 3 legacy wipe.  They will be rebuilt against the new
        # OpenLcb/OpenLcbNode API in Phase 6 and re-wired here.
        if [ -f test/integration.mjs ]; then
            echo "  - test/integration.mjs"
            node test/integration.mjs || fail "test/integration.mjs failed"
        fi
        if [ -d test/harness ] && npm run | grep -q "^  conformance$"; then
            echo "  - npm run conformance"
            if [ "$VERBOSE" -eq 1 ]; then
                npm run conformance || fail "conformance tests failed"
            else
                npm run conformance >/tmp/wasm_update_wizard_conformance.log 2>&1 \
                    || { cat /tmp/wasm_update_wizard_conformance.log >&2; fail "conformance tests failed"; }
            fi
        fi
    )

    ok "Test suite passed"
else
    echo "${C_YELLOW}Skipping test suite (--skip-tests)${C_RESET}"
fi

# ----------------------------------------------------------------------------
# 8. Build bundles
# ----------------------------------------------------------------------------
if [ "$SKIP_BUNDLES" -eq 0 ]; then
    section "8/8  Build bundles"

    require_tool npm

    (
        cd "${REPO_ROOT}"
        if [ "$VERBOSE" -eq 1 ]; then
            npm run build || fail "npm run build failed"
        else
            npm run build >/tmp/wasm_update_wizard_build_bundles.log 2>&1 \
                || { cat /tmp/wasm_update_wizard_build_bundles.log >&2; fail "npm run build failed"; }
        fi
    )

    ok "Bundles built"
else
    echo "${C_YELLOW}Skipping bundle rebuild (--skip-bundles)${C_RESET}"
fi

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
section "WASM update wizard complete"
if [ -n "${OLD_COMMIT}" ] && [ "${OLD_COMMIT}" != "${CLIB_COMMIT}${CLIB_DIRTY}" ]; then
    echo "${C_GREEN}Updated:${C_RESET} ${OLD_COMMIT} -> ${CLIB_COMMIT}${CLIB_DIRTY}"
elif [ -n "${OLD_COMMIT}" ]; then
    echo "${C_GREEN}Unchanged:${C_RESET} ${CLIB_COMMIT}${CLIB_DIRTY}"
else
    echo "${C_GREEN}Initial:${C_RESET} ${CLIB_COMMIT}${CLIB_DIRTY}"
fi

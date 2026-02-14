#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer supports only macOS (Darwin)." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "${ARCH}" in
  arm64|aarch64)
    CF_ARCH="arm64"
    ;;
  x86_64)
    CF_ARCH="amd64"
    ;;
  *)
    echo "Unsupported macOS architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

VERSION_INPUT="${1:-latest}"
if [[ "${VERSION_INPUT}" == "latest" ]]; then
  VERSION_RAW="$(
    curl -fsSL "https://api.github.com/repos/cloudflare/cloudflared/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"
else
  VERSION_RAW="${VERSION_INPUT}"
fi

if [[ -z "${VERSION_RAW}" ]]; then
  echo "Failed to detect cloudflared version." >&2
  exit 1
fi

VERSION="${VERSION_RAW#v}"
DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-darwin-${CF_ARCH}.tgz"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Downloading cloudflared ${VERSION} for ${CF_ARCH}..."
curl -fL "${DOWNLOAD_URL}" -o "${TMP_DIR}/cloudflared.tgz"
tar -xzf "${TMP_DIR}/cloudflared.tgz" -C "${TMP_DIR}"

INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "${INSTALL_DIR}"
install -m 755 "${TMP_DIR}/cloudflared" "${INSTALL_DIR}/cloudflared"

echo
echo "cloudflared installed to ${INSTALL_DIR}/cloudflared"
echo "If needed, add this to your shell profile:"
echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
echo
echo "Check install:"
echo "  ${INSTALL_DIR}/cloudflared --version"

#!/bin/sh
set -eu

VM="${1:-oracle-vm}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRAPER_DIR="$DEPLOY_DIR/../../Jobs_Scraper_Global/scraper-go"

ssh "$VM" "mkdir -p ~/apply-stack"
rsync -az --delete --exclude .git "$SCRAPER_DIR/" "$VM":apply-stack/scraper-go/
rsync -az --delete "$DEPLOY_DIR/" "$VM":apply-stack/deploy/

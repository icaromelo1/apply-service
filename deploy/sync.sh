#!/bin/sh
set -eu

VM="${1:-oracle-vm}"
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$DEPLOY_DIR/.."
SCRAPER_DIR="$APP_DIR/../Jobs_Scraper_Global/scraper-go"

ssh "$VM" "mkdir -p ~/apply-stack"
rsync -az --delete --exclude .git "$SCRAPER_DIR/" "$VM":apply-stack/scraper-go/
rsync -az --delete --exclude .env "$DEPLOY_DIR/" "$VM":apply-stack/deploy/
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude data --exclude dist --exclude profile \
  "$APP_DIR/" "$VM":apply-stack/apply-service/
rsync -az --ignore-existing "$APP_DIR/profile/" "$VM":apply-stack/apply-service/profile/

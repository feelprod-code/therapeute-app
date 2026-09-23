#!/bin/bash
# Script de contrôle de santé pour TDT Thérapeute App
# Géré automatiquement par Antigravity

APP_DIR="/Users/guillaumephilippe/ANTIGRAVITY/therapeute-app"
PLIST_PATH="$HOME/Library/LaunchAgents/com.feelprod.tdt-therapeute.plist"

# Si le serveur répond déjà sur le port 3001, on sort immédiatement
if curl -s -m 1 http://localhost:3001 >/dev/null 2>&1; then
  exit 0
fi

echo "🚀 Réactivation du serveur Thérapeute App..."
# Assurer le chargement du LaunchAgent
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH" 2>/dev/null

# Attendre que le port réponde
for i in {1..30}; do
  if curl -s -m 1 http://localhost:3001 >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.15
done

exit 0

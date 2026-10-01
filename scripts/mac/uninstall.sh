#!/bin/bash
# Arrête Émile et retire le démarrage automatique. Tes fichiers (~/Emile) sont conservés.
LABEL="com.emile.sowesoft"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
echo "✅ Émile est arrêté et ne redémarrera plus tout seul."
echo "   Pour tout supprimer (sessions WhatsApp/SoWeSoft comprises) : rm -rf ~/Emile"

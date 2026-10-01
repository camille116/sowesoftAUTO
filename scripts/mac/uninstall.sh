#!/bin/bash
# Arrête LinkeD et retire le démarrage automatique et l'app. Tes fichiers (~/LinkeD) sont conservés.
LABEL="com.linked.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "/Applications/LinkeD.app" "$HOME/Applications/LinkeD.app"
echo "✅ LinkeD est arrêté et ne redémarrera plus tout seul."
echo "   Pour tout supprimer (sessions et réglages compris) : rm -rf ~/LinkeD"

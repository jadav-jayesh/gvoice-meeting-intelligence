#!/usr/bin/env bash
# Microsoft Calendar — finish Entra app config for the delegated OAuth flow.
#
# App: "Groovy-bot"  appId 4f23ed66-314d-4134-a5d6-9e7890b65168
# Home tenant: f25dcef7-d758-4b2d-bad0-05f7302882af   (multi-tenant / AzureADMultipleOrgs)
#
# REQUIRES an admin who can modify the app registration:
#   Global Administrator, Application Administrator, or Cloud Application
#   Administrator — OR be added as an Owner of the app.
#   (The current signed-in user lacked privileges: "Insufficient privileges".)
#
# What this does (ALL ADDITIVE — existing Teams-bot permissions are preserved):
#   1. Registers the Web redirect URI for the calendar OAuth callback.
#   2. Adds delegated Microsoft Graph permissions: Calendars.Read, User.Read,
#      offline_access  (openid/email/profile are auto-granted, not declared).
#   3. (optional) Grants admin consent for THIS tenant.
#
# Usage:  az login   (as an admin)   then:   bash deploy/azure-ms-calendar-setup.sh
set -euo pipefail

APP=4f23ed66-314d-4134-a5d6-9e7890b65168
GRAPH=00000003-0000-0000-c000-000000000000

# --- redirect URIs ----------------------------------------------------------
# Dev (localhost is the ONLY non-HTTPS host Microsoft accepts).
# Add the production HTTPS URI once the domain + TLS are live, e.g.:
#   https://<your-domain>/api/calendar/microsoft/callback
DEV_REDIRECT="http://localhost:3000/api/calendar/microsoft/callback"
# PROD_REDIRECT="https://<your-domain>/api/calendar/microsoft/callback"

echo "==> 1/3  Registering web redirect URI(s)"
az ad app update --id "$APP" --web-redirect-uris \
  "$DEV_REDIRECT"
  # "$PROD_REDIRECT"   # uncomment + set when prod TLS is ready

echo "==> 2/3  Adding delegated Graph permissions (merged with existing)"
# Pull current required-resource-access, append the 3 delegated scopes to the
# Graph entry only, leave everything else untouched.
az ad app show --id "$APP" --query requiredResourceAccess -o json > /tmp/_rra_cur.json
jq '
 [ .[]
   | if .resourceAppId=="'"$GRAPH"'"
     then .resourceAccess += [
       {"id":"465a38f9-76ea-45b9-9f34-9e8b0d4b0b42","type":"Scope"},  # Calendars.Read
       {"id":"e1fe6dd8-ba31-4d61-89e7-88639da4683d","type":"Scope"},  # User.Read
       {"id":"7427e0e9-2fba-42fe-b0c0-848c9e6a8182","type":"Scope"}   # offline_access
     ]
     else . end ]
' /tmp/_rra_cur.json > /tmp/_rra_new.json
az ad app update --id "$APP" --required-resource-accesses @/tmp/_rra_new.json

echo "==> 3/3  (optional) Grant admin consent for the current tenant"
echo "    Run manually if desired (needs admin):"
echo "    az ad app permission admin-consent --id $APP"

echo "Done. Verify:"
echo "  az ad app show --id $APP --query '{web:web.redirectUris, perms:requiredResourceAccess}'"

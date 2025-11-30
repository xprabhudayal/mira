#!/bin/bash
# Quick script to check WhatsApp token validity

source .env.local 2>/dev/null || true

echo "=== WhatsApp Token Check ==="
echo ""

# Check token info
echo "Checking token info..."
curl -s "https://graph.facebook.com/debug_token?input_token=${WHATSAPP_ACCESS_TOKEN}&access_token=${WHATSAPP_ACCESS_TOKEN}" | python3 -m json.tool 2>/dev/null || echo "Failed to parse response"

echo ""
echo "=== Checking Phone Number ==="
curl -s "https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}?access_token=${WHATSAPP_ACCESS_TOKEN}" | python3 -m json.tool 2>/dev/null || echo "Failed to parse response"

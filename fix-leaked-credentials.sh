#!/bin/bash

# Script to remove leaked credentials from git history
# Run this immediately after discovering the leak

echo "🚨 CREDENTIAL LEAK FIX SCRIPT"
echo "================================"
echo ""
echo "⚠️  WARNING: This will rewrite git history!"
echo "⚠️  Make sure you've already:"
echo "    1. Revoked/regenerated your WhatsApp access token"
echo "    2. Changed your phone number ID if possible"
echo ""
read -p "Have you revoked the exposed credentials? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Please revoke credentials first, then run this script again."
    exit 1
fi

echo ""
echo "📝 Step 1: Removing files from git cache..."
git rm --cached README.md SETUP_GUIDE.md WHATSAPP_MIGRATION.md env.example

echo ""
echo "✅ Step 2: Files have been sanitized (already done)"
echo ""
echo "📝 Step 3: Adding cleaned files back..."
git add README.md SETUP_GUIDE.md WHATSAPP_MIGRATION.md env.example

echo ""
echo "📝 Step 4: Amending the last commit..."
git commit --amend -m "Initial commit - sanitized credentials"

echo ""
echo "⚠️  FINAL STEP: Force push to overwrite history"
echo "This will permanently remove the leaked credentials from GitHub"
echo ""
read -p "Ready to force push? (yes/no): " push_confirm

if [ "$push_confirm" = "yes" ]; then
    echo ""
    echo "🚀 Force pushing to origin main..."
    git push --force origin main
    
    echo ""
    echo "✅ Done! Your credentials have been removed from git history."
    echo ""
    echo "🔒 IMPORTANT NEXT STEPS:"
    echo "1. Verify on GitHub that the old commit is gone"
    echo "2. Update your .env.local with NEW credentials"
    echo "3. Test your application with new credentials"
    echo "4. Monitor your Meta dashboard for any suspicious activity"
else
    echo ""
    echo "⏸️  Skipped force push. When ready, run:"
    echo "   git push --force origin main"
fi

echo ""
echo "✨ Script complete!"

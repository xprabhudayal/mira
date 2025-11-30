# Quick Vercel Blob Setup

## Option 1: Via Vercel Dashboard (Easiest)

1. Go to https://vercel.com/dashboard
2. Select your project "mira"
3. Go to **Storage** tab
4. Click **Create Database**
5. Select **Blob**
6. Click **Create**
7. Copy the `BLOB_READ_WRITE_TOKEN` that appears
8. Add it to your project:
   - Click **Connect to Project**
   - Select "mira"
   - It will auto-add the env var

## Option 2: Via CLI

```bash
# Add the token to your project
vercel env add BLOB_READ_WRITE_TOKEN

# When prompted:
# - Select: Production, Preview, Development
# - Paste your token
```

## Get Your Token

Your token will be automatically available after creating Blob storage.
It looks like: `vercel_blob_rw_xxxxxxxxxxxxxxxxx`

## Test It

```bash
# Pull env vars locally
vercel env pull .env.local

# Check if token is there
cat .env.local | grep BLOB
```

Done! 🎉

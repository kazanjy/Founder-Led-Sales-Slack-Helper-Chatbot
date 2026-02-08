# Adding Custom Domain to Vercel

## Domain: `mikeybot.io`

## Overview
Adding the custom domain requires updates to:
1. Vercel project settings
2. Environment variables
3. OAuth provider configurations (Google, Slack)
4. Stripe webhook endpoints

---

## Step 1: GoDaddy DNS Configuration

In GoDaddy DNS Management for `mikeybot.io`:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `76.76.21.21` | 600 |
| **CNAME** | `www` | `cname.vercel-dns.com` | 600 |

Then in Vercel, add both domains and configure `www.mikeybot.io` to redirect to `mikeybot.io`.

---

## Step 2: Update Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | New Value |
|----------|-----------|
| `NEXT_PUBLIC_APP_URL` | `https://mikeybot.io` |

---

## Step 3: Google OAuth Configuration

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Your OAuth Client:

### Authorized JavaScript Origins
Add:
```
https://mikeybot.io
```

### Authorized Redirect URIs
Add:
```
https://mikeybot.io/api/auth/google/callback
```

---

## Step 4: Slack App Configuration

In [Slack API Dashboard](https://api.slack.com/apps) → Your App:

### OAuth & Permissions → Redirect URLs
Add:
```
https://mikeybot.io/api/slack/oauth/callback
https://mikeybot.io/api/auth/slack/callback
```

### Event Subscriptions → Request URL
Update to:
```
https://mikeybot.io/api/slack/events
```

---

## Step 5: Stripe Configuration (if using)

In [Stripe Dashboard](https://dashboard.stripe.com/) → Developers → Webhooks:

1. Add new webhook endpoint: `https://mikeybot.io/api/stripe/webhook`
2. Select same events as existing webhook
3. Update `STRIPE_WEBHOOK_SECRET` env var with new signing secret

---

## Step 6: Testing Checklist

- [ ] `https://mikeybot.io` loads
- [ ] Google Sign In works
- [ ] Slack Sign In works
- [ ] Slack App Install works
- [ ] Slack messages get responses
- [ ] Share links use `mikeybot.io`
- [ ] Stripe checkout works (if applicable)

---

## Quick Reference - All URLs to Configure

```
# Environment Variable
NEXT_PUBLIC_APP_URL=https://mikeybot.io

# Google OAuth
https://mikeybot.io
https://mikeybot.io/api/auth/google/callback

# Slack OAuth
https://mikeybot.io/api/slack/oauth/callback
https://mikeybot.io/api/auth/slack/callback

# Slack Events
https://mikeybot.io/api/slack/events

# Stripe Webhook
https://mikeybot.io/api/stripe/webhook
```

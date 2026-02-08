# Adding Custom Domain to Vercel

## Overview
Adding a custom domain (e.g., `askmikey.ai`) to the Vercel project requires updates to:
1. Vercel project settings
2. Environment variables
3. OAuth provider configurations (Google, Slack)
4. Stripe webhook endpoints

---

## Step 1: Vercel Domain Configuration

In Vercel Dashboard → Project → Settings → Domains:

1. Add your custom domain (e.g., `askmikey.ai`)
2. Configure DNS records as instructed:
   - **Option A (Recommended)**: Add CNAME record pointing to `cname.vercel-dns.com`
   - **Option B**: Add A record pointing to Vercel's IP `76.76.21.21`
3. Wait for SSL certificate provisioning (automatic)
4. Optionally add `www.askmikey.ai` and redirect to apex domain

---

## Step 2: Update Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables:

| Variable | Old Value | New Value |
|----------|-----------|-----------|
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | `https://askmikey.ai` |

This single env var is used throughout the codebase for:
- OAuth redirect URIs
- Share links
- Email links
- Stripe success/cancel URLs

---

## Step 3: Google OAuth Configuration

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Your OAuth Client:

### Authorized JavaScript Origins
Add:
```
https://askmikey.ai
```

### Authorized Redirect URIs
Add:
```
https://askmikey.ai/api/auth/google/callback
```

Keep the old Vercel URL temporarily for rollback safety.

---

## Step 4: Slack App Configuration

In [Slack API Dashboard](https://api.slack.com/apps) → Your App:

### OAuth & Permissions → Redirect URLs
Add these redirect URLs:
```
https://askmikey.ai/api/slack/oauth/callback
https://askmikey.ai/api/auth/slack/callback
```

### Event Subscriptions → Request URL
Update to:
```
https://askmikey.ai/api/slack/events
```

### Interactivity & Shortcuts → Request URL (if enabled)
Update to:
```
https://askmikey.ai/api/slack/interactions
```

### Slash Commands (if any)
Update request URLs to use `https://askmikey.ai/...`

---

## Step 5: Stripe Configuration (if using)

In [Stripe Dashboard](https://dashboard.stripe.com/) → Developers → Webhooks:

1. Add new webhook endpoint: `https://askmikey.ai/api/stripe/webhook`
2. Select events to listen for (same as existing webhook)
3. Copy the new webhook signing secret
4. Update `STRIPE_WEBHOOK_SECRET` env var in Vercel
5. Keep old webhook active temporarily

---

## Step 6: Testing Checklist

After making changes, test each flow:

- [ ] **Homepage loads** at `https://askmikey.ai`
- [ ] **Google Sign In** works (redirects back correctly)
- [ ] **Slack Sign In** works (redirects back correctly)
- [ ] **Slack App Install** works (OAuth flow completes)
- [ ] **Slack Events** work (messages in Slack get responses)
- [ ] **Share Links** use correct domain
- [ ] **Email Links** use correct domain
- [ ] **Stripe Checkout** success/cancel URLs work
- [ ] **Stripe Webhooks** are received

---

## Step 7: Cleanup (After Verification)

Once everything works:

1. Remove old Vercel URL from Google OAuth redirect URIs
2. Remove old Vercel URL from Slack redirect URLs
3. Delete old Stripe webhook endpoint
4. Update any documentation/README with new domain

---

## Files Using `NEXT_PUBLIC_APP_URL`

For reference, these files use the app URL (all read from env var, no code changes needed):

| File | Usage |
|------|-------|
| `src/app/api/auth/google/route.ts` | Google OAuth redirect URI |
| `src/app/api/auth/google/callback/route.ts` | Redirect after Google auth |
| `src/app/api/auth/slack/route.ts` | Slack OAuth redirect URI |
| `src/app/api/auth/slack/callback/route.ts` | Redirect after Slack auth |
| `src/app/api/slack/oauth/route.ts` | Slack app install OAuth |
| `src/app/api/slack/oauth/callback/route.ts` | Redirect after app install |
| `src/app/api/stripe/checkout/route.ts` | Success/cancel URLs |
| `src/app/api/stripe/portal/route.ts` | Return URL |
| `src/app/api/conversations/[id]/share/route.ts` | Share link generation |
| `src/app/api/conversations/[id]/email/route.ts` | Links in emails |
| `src/app/share/[code]/page.tsx` | OG meta tags |
| `src/lib/slack/events.ts` | Links sent to Slack users |

---

## Rollback Plan

If issues occur:
1. Revert `NEXT_PUBLIC_APP_URL` env var to old Vercel URL
2. OAuth providers still have old URLs configured
3. Old Stripe webhook still active

---

## Notes

- DNS propagation can take up to 48 hours (usually much faster)
- Vercel automatically handles SSL certificates
- Keep both domains working during transition period

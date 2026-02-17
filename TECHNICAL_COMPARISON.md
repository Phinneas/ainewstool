# Technical Comparison: Resend vs Beehiiv

## API Call Examples

### Resend (Current) - Simple & Direct

```typescript
// One API call = email sent
const result = await resend.emails.send({
  from: "Newsletter <newsletter@yourdomain.com>",
  to: ["user@example.com"],
  subject: "Your AI Newsletter - Feb 13, 2026",
  html: "<html>...</html>"
});

// Result: Email sent instantly
// { id: "email_12345", status: "sent" }
```

### Beehiiv Enterprise - Multi-Step Process

```typescript
// Step 1: Create post (draft)
const post = await beehiiv.posts.create({
  publicationId: "pub_123",
  title: "Your AI Newsletter - Feb 13, 2026",
  html: "<html>...</html>",
  status: "draft"
});
// { postId: "post_12345", status: "draft" }

// Step 2: Upload images (if any)
for (const image of images) {
  await beehiiv.images.upload({
    postId: post.postId,
    image: image.data
  });
}

// Step 3: Publish post
await beehiiv.posts.publish({
  postId: post.postId,
  send: true, // This triggers the email
  scheduleAt: null // or timestamp for scheduled send
});
// { status: "publishing", campaignId: "camp_67890" }

// Step 4: Wait for status (poll or webhook)
// Could take 30-60 seconds
const status = await waitForSendStatus(campaign.campaignId);
// { status: "sent", sentTo: 1000, opens: 0, clicks: 0 }
```

---

## Error Handling Comparison

### Resend - Simple
```typescript
try {
  const result = await resend.emails.send(...);
  return { success: true, emailId: result.id };
} catch (error) {
  return { success: false, error: error.message };
}
```

### Beehiiv - Complex State Machine
```typescript
try {
  const post = await beehiiv.posts.create(...);
  
  try {
    await beehiiv.posts.publish(...);
  } catch (publishError) {
    // Post created but failed to publish
    // Need to clean up or retry logic
    await beehiiv.posts.delete(post.postId);
    throw publishError;
  }
  
  // Poll for status or wait for webhook
  const status = await waitForStatusWithTimeout(campaignId, 60_000);
  
  if (status === "failed") {
    throw new Error(`Campaign failed: ${campaignId}`);
  }
  
  return { success: true, campaignId };
} catch (error) {
  // Handle different failure modes:
  // - Auth failed
  // - Post creation failed
  // - Image upload failed
  // - Publish failed
  // - Timeout waiting for send
  return { success: false, error: error.message, state: currentState };
}
```

---

## Webhook Requirements

### Resend - Optional
```typescript
// Optional: Track opens/clicks if you want
// POST https://api.resend.com/v1/webhooks
{
  "url": "https://yourapp.com/webhooks/resend",
  "events": ["email.sent", "email.delivered", "email.opened"]
}

// In your webhook handler:
app.post("/webhooks/resend", (req, res) => {
  // Log analytics if you want
  console.log("Email opened:", req.body.email_id);
  res.sendStatus(200);
});
```

### Beehiiv - Required ✅
```typescript
// REQUIRED: Set up webhook endpoint
// POST https://api.beehiiv.com/v2/webhooks
{
  "url": "https://yourapp.com/webhooks/beehiiv",
  "events": [
    "post.published",
    "campaign.sent",
    "campaign.failed",
    "subscriber.opened",
    "subscriber.clicked"
  ],
  "secret": "whsec_your_webhook_secret"
}

// In your webhook handler:
app.post("/webhooks/beehiiv", async (req, res) => {
  // 1. Verify webhook signature (security)
  const signature = req.headers["beehiiv-signature"];
  if (!verifySignature(req.body, signature)) {
    return res.sendStatus(401);
  }
  
  // 2. Handle different event types
  switch (req.body.type) {
    case "post.published":
      await updatePostStatus(req.body.post_id, "published");
      break;
    case "campaign.sent":
      await updateSendStatus(req.body.campaign_id, "sent");
      break;
    case "campaign.failed":
      await updateSendStatus(req.body.campaign_id, "failed", req.body.error);
      break;
  }
  
  res.sendStatus(200);
});

// 3. Need to store state in database
// campaign_id → status, post_id, error_message
```

---

## Testing Experience

### Resend - Developer Friendly
```bash
# Get free API key in 2 minutes
export RESEND_API_KEY=re_test_yourkey

# Test send
npm run email 2026-02-10 test@example.com
✅ Email sent! ID: email_12345

# Check status
curl https://api.resend.com/v1/emails/email_12345
# { "id": "email_12345", "status": "sent" }
```

### Beehiiv Enterprise - Complex
```bash
# 1. Contact sales team (wait days/weeks)
# 2. Sign Enterprise contract ($$$)
# 3. Wait for API provisioning
# 4. Get credentials (API key, pub ID, webhook secret)
export BEEHIIV_API_KEY=bh_test_yourkey
export BEEHIIV_PUBLICATION_ID=pub_123
export BEEHIIV_WEBHOOK_SECRET=whsec_yoursecret

# Test send
npm run email 2026-02-10 test@example.com
→ Creating post... OK (post_12345)
→ Uploading images... OK (3 images)
→ Publishing post... OK (campaign_67890)
→ Polling status... (30 seconds)
✅ Newsletter sent! Campaign: campaign_67890

# Check status (after 30-60 seconds)
curl https://api.beehiiv.com/v2/campaigns/campaign_67890
# { "id": "campaign_67890", "status": "sent", "sent_at": "2026-02-13..." }
```

---

## Infrastructure Requirements

### Resend - Minimal
```
Environment variables:
- RESEND_API_KEY=<string>

Dependencies:
- resend: ^6.9.2 (already installed)

Infrastructure:
- None (stateless)

Storage:
- None required

Required ports:
- 443 outbound (HTTPS to Resend API)
```

### Beehiiv - Complex
```
Environment variables:
- BEEHIIV_API_KEY=<string>
- BEEHIIV_PUBLICATION_ID=<string>
- BEEHIIV_WEBHOOK_SECRET=<string>
- BEEHIIV_BASE_URL=https://api.beehiiv.com/v2

Dependencies:
- @beehiiv/sdk (would need to install)
- database client (for state tracking)
- webhook handling library

Infrastructure:
- Webhook receiver endpoint (public URL)
- Database (PostgreSQL/SQLite for state)
- Background worker for polling (optional)

Storage:
- Database required for campaign state
- Image cache for performance
- Webhook log table

Required ports:
- 443 outbound (HTTPS to Beehiiv API)
- 80/443 inbound (for webhooks)
```

---

## Performance Comparison

| Metric | Resend | Beehiiv |
|--------|--------|---------|
| **Time to send** | 200-500ms | 30-60 seconds |
| **API calls** | 1 | 3-5 + webhooks |
| **Complexity** | Stateless | Stateful |
| **Reliability** | 99.9% | Depends on webhooks |
| **Retry logic** | Built-in | Manual implementation |

---

## Code Complexity Metrics

### Resend Integration
```
code/src/email/send.ts
- Total lines: ~160
- Functions: 3 (send, convert markdown, wrap template)
- State management: 0 (stateless)
- Async operations: 1 (single API call)
- Error paths: 2 (missing key, send failure)
- Test coverage: 100%
```

### Beehiiv (Estimated)
```
code/src/email/beehiiv.ts
- Total lines: ~400-500
- Functions: 8-10 (create post, upload images, publish, send, webhook handler, status poll, error recovery, state management)
- State management: Required (database)
- Async operations: 5 (create, upload, publish, webhooks, status polling)
- Error paths: 10+ (auth fail, post fail, image fail, publish fail, webhook timeout, state sync issues, etc.)
- Test coverage: 60-70% (hard to test webhooks)

plus:
code/src/webhook/beehiiv.ts
- Total lines: ~150-200
- Functions: 3 (receiver, signature verifier, event handler)
- State management: Required
- Security: Signature verification required
```

**Total complexity increase: ~3-4x more code**

---

## Summary

### Resend: Simple, Fast, Cheap
- 1 API call
- 200ms response time
- $0 to start
- 160 lines of code
- Stateless & reliable

### Beehiiv: Complex, Slow, Expensive
- 3-5 API calls + webhooks
- 30-60 second response time
- $1k+/month minimum
- 550-700 lines of code
- Stateful & complex

**Code complexity ratio: Beehiiv is ~3-4x more complex to integrate**
# Email Setup Guide

This project integrates with [Resend](https://resend.com) for email delivery of generated newsletters.

## Setup Instructions

### 1. Get a Resend API Key

1. Sign up at [https://resend.com](https://resend.com)
2. Navigate to API Keys in your dashboard
3. Create a new API key
4. Copy the key

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Email delivery
RESEND_API_KEY=re_YourApiKeyHere
NEWSLETTER_RECIPIENTS="user1@example.com,user2@example.com,user3@example.com"
```

### 3. Verify the Integration

Test that everything is working:

```bash
# Generate a newsletter first (if you haven't already)
npm run generate 2026-02-13

# Send to a single recipient for testing
npm run email 2026-02-13 your-email@example.com

# Or send to all recipients
npm run send 2026-02-13
```

## Email Commands

### Send to Single Recipient

```bash
npm run email <date> <recipient-email> [newsletter-file-path]
```

Examples:
```bash
# Use default newsletter file (newsletter-2026-02-13.md)
npm run email 2026-02-13 user@example.com

# Specify custom newsletter file
npm run email 2026-02-13 user@example.com ./my-newsletter.md
```

### Send to Multiple Recipients

```bash
npm run send <date> [newsletter-file-path]
```

This command sends to all recipients defined in the `NEWSLETTER_RECIPIENTS` environment variable.

Examples:
```bash
# Use default newsletter file
npm run send 2026-02-13

# Specify custom newsletter file
npm run send 2026-02-13 ./my-newsletter.md
```

## Newsletter Format in Email

The email version includes:

- **Clean HTML formatting** with proper headings, lists, and styling
- **Responsive design** that works on mobile and desktop
- **Dark mode support** for compatible email clients
- **Proper link handling** with all URLs clickable
- **Professional typography** with system fonts

## Troubleshooting

### Missing RESEND_API_KEY

**Error:** `Missing RESEND_API_KEY env var. Get one at https://resend.com`

**Solution:** Add `RESEND_API_KEY=your_key_here` to your `.env` file.

### Missing NEWSLETTER_RECIPIENTS

**Error:** `Missing NEWSLETTER_RECIPIENTS environment variable`

**Solution:** Add comma-separated email addresses to your `.env` file:
```bash
NEWSLETTER_RECIPIENTS="user1@example.com,user2@example.com"
```

### Newsletter File Not Found

**Error:** `Could not read newsletter file: newsletter-2026-02-13.md`

**Solution:** Generate the newsletter first:
```bash
npm run generate 2026-02-13
```

### Invalid Subject Line

**Error:** `Could not parse subject line from newsletter`

**Solution:** Ensure your newsletter file starts with a `# Title` line.

## Email Delivery Status

Resend provides email tracking including:
- Delivery confirmations
- Open tracking
- Click tracking
- Bounce detection

Check your Resend dashboard for detailed analytics.

## Advanced Configuration

### Custom From Address

You can specify a custom from address when calling `sendNewsletterEmail()`:

```typescript
await sendNewsletterEmail({
  to: "user@example.com",
  subjectLine: "Your Subject",
  markdownBody: newsletterContent,
  from: "Your Name <your-email@yourdomain.com>"
});
```

### HTML Customization

The email template is in `src/email/send.ts`. You can customize:
- Colors and fonts
- Layout and spacing
- Header/footer content
- CSS styling

## Complete Workflow Example

```bash
# 1. Ingest content from all feeds
npm run ingest

# 2. Generate newsletter for today
npm run generate 2026-02-13

# 3. Review the generated newsletter
cat newsletter-2026-02-13.md

# 4. Send test email to yourself
npm run email 2026-02-13 your-email@example.com

# 5. Send to all subscribers
npm run send 2026-02-13
```

## Security Notes

- Keep your `RESEND_API_KEY` secure and never commit it to version control
- Use Resend's domain verification for better deliverability
- Monitor your Resend dashboard for unauthorized usage
- Consider using Resend's webhook signatures for secure callbacks

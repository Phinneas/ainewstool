import { Resend } from "resend";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "../logger.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** Load logo as base64 data URI for email embedding. */
function loadLogoDataUri() {
    try {
        const logoPath = join(__dirname, "../../assets/brainscriblr-logo.png");
        const buf = readFileSync(logoPath);
        return `data:image/png;base64,${buf.toString("base64")}`;
    }
    catch {
        // Graceful fallback — logo is optional
        return "";
    }
}
function markdownToBasicHtml(md) {
    return md
        // Headings
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        // Bold + italic
        .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        // Unordered list items
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        // Wrap consecutive <li> in <ul>
        .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
        // Horizontal rules
        .replace(/^---$/gm, "<hr>")
        // Paragraphs (double newline)
        .replace(/\n\n/g, "</p><p>")
        // Single newlines to <br>
        .replace(/\n/g, "<br>")
        // Wrap in <p>
        .replace(/^/, "<p>")
        .replace(/$/, "</p>")
        // Clean up empty paragraphs
        .replace(/<p><\/p>/g, "")
        .replace(/<p><hr><\/p>/g, "<hr>")
        .replace(/<p>(<h[1-3]>)/g, "$1")
        .replace(/(<\/h[1-3]>)<\/p>/g, "$1")
        // Fix list blocks wrapped in paragraphs (block elements can't be inside <p>)
        .replace(/<p>(<ul>)/g, "$1")
        .replace(/(<\/ul>)<\/p>/g, "$1")
        // Remove spurious <br> tags inside lists produced by the \n→<br> pass
        .replace(/(<\/li>)<br>/g, "$1")
        .replace(/<br>(<li>)/g, "$1")
        .replace(/<br>(<\/ul>)/g, "$1");
}
export async function sendNewsletterEmail(params) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error("Missing RESEND_API_KEY env var. Get one at https://resend.com");
    }
    const resend = new Resend(apiKey);
    const from = params.from ?? "BrainScriblr <onboarding@resend.dev>";
    const htmlContent = params.htmlBody || wrapInEmailTemplate(markdownToBasicHtml(params.markdownBody));
    log.info("Sending newsletter email", {
        to: Array.isArray(params.to) ? params.to.join(", ") : params.to,
        subject: params.subjectLine,
    });
    const { data, error } = await resend.emails.send({
        from,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subjectLine,
        html: htmlContent,
    });
    if (error) {
        log.error("Failed to send email", { error: error.message });
        throw new Error(`Resend error: ${error.message}`);
    }
    log.info("Email sent successfully", { id: data?.id });
    return { id: data?.id ?? "unknown" };
}
function wrapInEmailTemplate(bodyHtml) {
    const logoDataUri = loadLogoDataUri();
    const logoHtml = logoDataUri
        ? `<img src="${logoDataUri}" alt="BrainScriblr" width="48" height="48" style="display:block;border-radius:10px;" />`
        : "";
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #1a1a1a; margin: 0; padding: 0; background-color: #f4f4f7; }
    .email-wrapper { max-width: 640px; margin: 0 auto; background: #ffffff; }
    .header { background: #0a0a2e; padding: 24px 32px; text-align: center; }
    .header-logo { display: inline-block; vertical-align: middle; margin-right: 12px; }
    .header-title { display: inline-block; vertical-align: middle; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; background: linear-gradient(135deg, #4fd1c5, #9f7aea); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .header-title-fallback { color: #4fd1c5; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .content { padding: 24px 32px 32px; }
    h1 { font-size: 24px; margin-top: 28px; color: #0a0a2e; }
    h2 { font-size: 20px; margin-top: 24px; color: #0a0a2e; }
    h3 { font-size: 17px; color: #1a1a1a; }
    a { color: #6b46c1; text-decoration: underline; }
    a:hover { color: #4fd1c5; }
    hr { border: none; border-top: 2px solid #e9e5f5; margin: 24px 0; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    strong { color: #0a0a2e; }
    .footer { background: #0a0a2e; padding: 20px 32px; text-align: center; }
    .footer p { color: #8888aa; font-size: 13px; margin: 4px 0; }
    .footer a { color: #4fd1c5; text-decoration: none; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="header">
      <!--[if mso]>
      <span class="header-title-fallback">BrainScriblr</span>
      <![endif]-->
      <!--[if !mso]><!-->
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
        <tr>
          ${logoHtml ? `<td style="padding-right: 12px; vertical-align: middle;">${logoHtml}</td>` : ""}
          <td style="vertical-align: middle;">
            <span class="header-title">BrainScriblr</span>
          </td>
        </tr>
      </table>
      <!--<![endif]-->
    </div>
    <div class="content">
${bodyHtml}
    </div>
    <div class="footer">
      <p>You're receiving this because you subscribed to <a href="#">BrainScriblr</a>.</p>
      <p>AI news, tools &amp; trends — delivered fresh.</p>
    </div>
  </div>
</body>
</html>`;
}
export { markdownToBasicHtml, wrapInEmailTemplate };

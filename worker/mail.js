/**
 * Outgoing email. On Cloudflare, resendMailer sends through Resend (https://resend.com) with the
 * RESEND_API_KEY secret; the sending domain must be verified in Resend (see STAFF-AREA.md).
 * The local preview and the tests use memoryMailer, which keeps messages in a list and prints them.
 * A mailer is send({to, subject, text, html, replyTo}) and throws when the email isn't accepted.
 */
export const DEFAULT_FROM = 'Buzzflix <no-reply@buzzflix.ca>';
export const REPLY_TO = 'info@buzzflix.ca';

export const resendMailer = (apiKey, from = DEFAULT_FROM) => ({
  async send({to, subject, text, html, replyTo}) {
    if (!apiKey) throw new Error('RESEND_API_KEY is not set.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({from, to: [to], subject, text, html, ...(replyTo && {reply_to: replyTo})})
    });
    if (!response.ok) throw new Error(`Resend refused the email (${response.status}): ${await response.text()}`);
  }
});

export function memoryMailer({log = true} = {}) {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (log) console.log(`\n[email to ${message.to}] ${message.subject}\n${message.text}\n`);
    }
  };
}

export const escapeHtml = text => String(text).replace(/[&<>"']/g, char =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);

// A plain branded email: paragraphs of text, with an optional big code or button.
export function emailHtml(paragraphs, {code, link} = {}) {
  const p = text => `<p style="margin:0 0 16px;font:16px/1.5 Arial,sans-serif;color:#1a1a1a">${escapeHtml(text)}</p>`;
  const extra = code
    ? `<p style="margin:0 0 16px;font:600 32px/1.2 'Courier New',monospace;letter-spacing:6px;color:#1a1a1a">${escapeHtml(code)}</p>`
    : link ? `<p style="margin:0 0 24px"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#ee5934;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font:16px Arial,sans-serif">${escapeHtml(link.label)}</a></p>` : '';
  const [first, ...rest] = paragraphs;
  return `<div style="max-width:520px;padding:24px">${p(first)}${extra}${rest.map(p).join('')}</div>`;
}

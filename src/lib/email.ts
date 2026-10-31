import { getRuntimeSecret } from './admin.ts';
import { escapeHtml } from './user-auth.ts';

export const DEFAULT_EMAIL_FROM = 'CrockBites <no-reply@mail.crockbites.site>';
const RESEND_API_URL = 'https://api.resend.com/emails';

export function logEmailDiagnostic(stage: string, err: unknown, extra: Record<string, unknown> = {}): void {
  console.error('[CrockBites Email Diagnostic]', {
    stage,
    error: err instanceof Error ? err.message : String(err),
    ...extra,
  });
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Sends an email using Resend's REST API over standard fetch().
 * Fully compatible with Cloudflare Workers / Pages runtime.
 * Never leaks the API key in error messages or logs.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = getRuntimeSecret('RESEND_API_KEY');
  if (!apiKey) {
    return {
      ok: false,
      error: 'Transactional email provider is not configured (missing RESEND_API_KEY secret).',
    };
  }

  const fromAddress = options.from || getRuntimeSecret('EMAIL_FROM') || DEFAULT_EMAIL_FROM;
  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  if (recipients.length === 0 || recipients.some((r) => !r || !r.includes('@'))) {
    return { ok: false, error: 'Invalid recipient email address.' };
  }

  const payload: Record<string, unknown> = {
    from: fromAddress,
    to: recipients,
    subject: options.subject,
    html: options.html,
    text: options.text,
  };

  if (options.replyTo) {
    payload.reply_to = options.replyTo;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      const errorMsg =
        typeof data?.message === 'string'
          ? data.message
          : `Resend API returned HTTP ${res.status}`;
      logEmailDiagnostic('sendEmail:resend_error', errorMsg, {
        status: res.status,
      });
      return { ok: false, error: errorMsg };
    }

    const emailId = typeof data?.id === 'string' ? data.id : undefined;
    return { ok: true, id: emailId };
  } catch (err) {
    logEmailDiagnostic('sendEmail:fetch_exception', err);
    return {
      ok: false,
      error: 'An unexpected network error occurred while dispatching email.',
    };
  }
}

// ---------------------------------------------------------------------------
// CrockBites Branded Email Templates
// Brand Colors:
// - Forest Green:  #243A2D
// - Warm Cream:    #F7F1E5
// - Terracotta:    #C66A45
// - Paper/Card:    #FFFFFF
// - Text Dark:     #1C1917
// - Text Muted:    #57534E
// - Border:        #E7DFD3
// ---------------------------------------------------------------------------

function renderEmailShell({
  preheader,
  headerTitle,
  contentHtml,
}: {
  preheader: string;
  headerTitle: string;
  contentHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(headerTitle)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #F7F1E5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1C1917; -webkit-font-smoothing: antialiased; line-height: 1.6;">
  <!-- Preheader text hidden in inbox view -->
  <div style="display: none; font-size: 1px; color: #F7F1E5; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${escapeHtml(preheader)}
  </div>

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #F7F1E5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E7DFD3; overflow: hidden; box-shadow: 0 4px 12px rgba(36, 58, 45, 0.05);">
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #243A2D; padding: 28px 32px; text-align: center;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: bold; color: #F7F1E5; letter-spacing: -0.5px; text-decoration: none;">
                      Crock<span style="color: #E29373;">Bites</span>
                    </span>
                    <div style="margin-top: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #E7DFD3; opacity: 0.85;">
                      Good Food. Less Fuss.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAF6EE; padding: 24px 32px; border-top: 1px solid #E7DFD3; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #78716C; line-height: 1.5;">
                Sent with care from <strong>CrockBites</strong> · Easy Slow Cooker Recipes & Everyday Meals<br>
                <a href="https://crockbites.site" style="color: #243A2D; text-decoration: underline; font-weight: 600;">crockbites.site</a>
              </p>
              <p style="margin: 8px 0 0 0; font-size: 11px; color: #A8A29E;">
                This transactional email was sent to your registered address.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Builds the verification email template.
 */
export function renderVerificationEmail({
  displayName,
  verifyUrl,
}: {
  displayName?: string;
  verifyUrl: string;
}): { subject: string; html: string; text: string } {
  const name = displayName ? displayName.trim() : 'Kitchen Friend';
  const subject = 'Verify your email for CrockBites';

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: bold; color: #243A2D; line-height: 1.3;">
      Verify your kitchen account
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 15px; color: #1C1917;">
      Hi <strong>${escapeHtml(name)}</strong>,
    </p>

    <p style="margin: 0 0 24px 0; font-size: 15px; color: #44403C; line-height: 1.6;">
      Thank you for joining <strong>CrockBites</strong>! Please confirm your email address to complete your registration, secure your profile, and save your favorite slow-cooker recipes.
    </p>

    <!-- CTA Button -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td align="center" style="border-radius: 10px; background-color: #C66A45;">
          <a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 10px; letter-spacing: 0.2px;">
            Confirm Email Address →
          </a>
        </td>
      </tr>
    </table>

    <!-- Notice Box -->
    <div style="background-color: #F7F1E5; border-left: 4px solid #C66A45; border-radius: 6px; padding: 14px 16px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #57534E; line-height: 1.5;">
        <strong>Note:</strong> This verification link is valid for <strong>24 hours</strong>. When you open the link, you will be asked to confirm verification before your account is updated.
      </p>
    </div>

    <!-- Fallback URL -->
    <p style="margin: 24px 0 8px 0; font-size: 12px; color: #78716C;">
      If the button above does not work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0; font-size: 12px; color: #243A2D; word-break: break-all; font-family: monospace;">
      <a href="${escapeHtml(verifyUrl)}" style="color: #243A2D; text-decoration: underline;">${escapeHtml(verifyUrl)}</a>
    </p>

    <p style="margin: 28px 0 0 0; font-size: 13px; color: #78716C; border-top: 1px solid #F0ECE1; padding-top: 16px;">
      If you did not sign up for a CrockBites account, you can safely disregard this email.
    </p>
  `;

  const html = renderEmailShell({
    preheader: 'Please confirm your email address to complete your CrockBites account setup.',
    headerTitle: subject,
    contentHtml,
  });

  const text = `Hi ${name},

Thank you for joining CrockBites! Please confirm your email address to complete your registration, secure your profile, and save your favorite slow-cooker recipes.

Confirm your email by clicking the link below:
${verifyUrl}

This verification link is valid for 24 hours. For security, opening the link will ask you to confirm verification.

If you did not create a CrockBites account, you can safely ignore this email.

--
CrockBites
Good Food. Less Fuss.
https://crockbites.site`;

  return { subject, html, text };
}

/**
 * Builds the password reset email template.
 */
export function renderPasswordResetEmail({
  displayName,
  resetUrl,
}: {
  displayName?: string;
  resetUrl: string;
}): { subject: string; html: string; text: string } {
  const name = displayName ? displayName.trim() : 'Kitchen Friend';
  const subject = 'Reset your CrockBites password';

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: bold; color: #243A2D; line-height: 1.3;">
      Reset your password
    </h1>

    <p style="margin: 0 0 16px 0; font-size: 15px; color: #1C1917;">
      Hi <strong>${escapeHtml(name)}</strong>,
    </p>

    <p style="margin: 0 0 24px 0; font-size: 15px; color: #44403C; line-height: 1.6;">
      We received a request to reset the password for your CrockBites account. Click the button below to choose a new password:
    </p>

    <!-- CTA Button -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td align="center" style="border-radius: 10px; background-color: #243A2D;">
          <a href="${escapeHtml(resetUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 10px; letter-spacing: 0.2px;">
            Reset My Password →
          </a>
        </td>
      </tr>
    </table>

    <!-- Security Warning Box -->
    <div style="background-color: #F7F1E5; border-left: 4px solid #C66A45; border-radius: 6px; padding: 14px 16px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #57534E; line-height: 1.5;">
        <strong>Security Notice:</strong> This single-use password reset link will expire in <strong>30 minutes</strong>. If you did not request a password reset, you can safely ignore this message—your password has not been changed and your account remains secure.
      </p>
    </div>

    <!-- Fallback URL -->
    <p style="margin: 24px 0 8px 0; font-size: 12px; color: #78716C;">
      If the button above does not work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0; font-size: 12px; color: #243A2D; word-break: break-all; font-family: monospace;">
      <a href="${escapeHtml(resetUrl)}" style="color: #243A2D; text-decoration: underline;">${escapeHtml(resetUrl)}</a>
    </p>

    <p style="margin: 28px 0 0 0; font-size: 13px; color: #78716C; border-top: 1px solid #F0ECE1; padding-top: 16px;">
      For security reasons, changing your password will revoke all currently active sessions across all devices.
    </p>
  `;

  const html = renderEmailShell({
    preheader: 'Instructions to reset your CrockBites account password (expires in 30 minutes).',
    headerTitle: subject,
    contentHtml,
  });

  const text = `Hi ${name},

We received a request to reset the password for your CrockBites account.

Click the link below to choose a new password:
${resetUrl}

This single-use password reset link will expire in 30 minutes.

If you did not request a password reset, you can safely ignore this message. Your password will remain unchanged.

--
CrockBites
Good Food. Less Fuss.
https://crockbites.site`;

  return { subject, html, text };
}

/**
 * High-level helper to deliver an email verification message.
 */
export async function sendVerificationEmail({
  to,
  displayName,
  verifyUrl,
}: {
  to: string;
  displayName?: string;
  verifyUrl: string;
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderVerificationEmail({ displayName, verifyUrl });
  return sendEmail({ to, subject, html, text });
}

/**
 * High-level helper to deliver a password reset message.
 */
export async function sendPasswordResetEmail({
  to,
  displayName,
  resetUrl,
}: {
  to: string;
  displayName?: string;
  resetUrl: string;
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderPasswordResetEmail({ displayName, resetUrl });
  return sendEmail({ to, subject, html, text });
}

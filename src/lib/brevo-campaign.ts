import { getRuntimeSecret } from './admin.ts';
import type { D1Database } from './db.ts';
import { escapeHtml } from './user-auth.ts';

export const BREVO_CAMPAIGNS_API_URL = 'https://api.brevo.com/v3/emailCampaigns';
export const DEFAULT_BREVO_SENDER = {
  name: 'CrockBites',
  email: 'no-reply@mail.crockbites.site',
};
export const DEFAULT_NEWSLETTER_LIST_ID = 3;

export interface RecipeNotificationParams {
  slug: string;
  title: string;
  description?: string;
  image?: string;
  imageAlt?: string;
  prepMinutes?: number;
  cookMinutes?: number;
  servings?: number;
  category?: string;
}

export interface RecipeNotificationResult {
  ok: boolean;
  status: 'sent' | 'pending' | 'failed' | 'skipped';
  campaignId?: string;
  error?: string;
  reason?: string;
  dryRun?: boolean;
}

export interface RecipeNewsletterRecord {
  id: string;
  recipe_slug: string;
  recipe_title: string;
  campaign_id: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  list_id: number;
  recipient_count: number;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

export function isBrevoCampaignConfigured(): {
  configured: boolean;
  sender: string;
  listId: number;
} {
  const apiKey = getRuntimeSecret('BREVO_API_KEY');
  return {
    configured: Boolean(apiKey),
    sender: `${DEFAULT_BREVO_SENDER.name} <${DEFAULT_BREVO_SENDER.email}>`,
    listId: DEFAULT_NEWSLETTER_LIST_ID,
  };
}

function formatDuration(minutes?: number): string {
  if (!minutes || minutes <= 0) return '';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
  return `${mins} min${mins > 1 ? 's' : ''}`;
}

/**
 * Builds the responsive HTML and plain-text newsletter email for a newly published recipe.
 * Uses Brevo-compliant tags for unsubscribe ({{ unsubscribe }}) and web mirror ({{ mirror }}).
 */
export function renderRecipeNewsletterEmail(params: RecipeNotificationParams): {
  subject: string;
  html: string;
  text: string;
} {
  const title = (params.title || 'Delicious New Recipe').trim();
  const description = (params.description || 'Check out our latest slow cooker recipe on CrockBites.').trim();
  const slug = (params.slug || '').trim();
  const recipeUrl = `https://crockbites.site/recipe/${encodeURIComponent(slug)}/`;

  // Ensure absolute image URL
  let imageUrl = (params.image || '').trim();
  if (!imageUrl || imageUrl.includes('placeholder')) {
    imageUrl = 'https://crockbites.site/images/og-default.png';
  } else if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
    imageUrl = `https://crockbites.site${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
  }

  const imageAlt = params.imageAlt || `${title} Slow Cooker Recipe`;
  const subject = `New Recipe: ${title} 🍲`;
  const prepText = formatDuration(params.prepMinutes);
  const cookText = formatDuration(params.cookMinutes);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #F7F1E5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1C1917; -webkit-font-smoothing: antialiased; line-height: 1.6;">
  <!-- Preheader text hidden in inbox view -->
  <div style="display: none; font-size: 1px; color: #F7F1E5; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${escapeHtml(description)}
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
            <td style="padding: 32px 32px 24px 32px;">
              <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #C66A45;">
                Fresh from the Slow Cooker
              </p>

              <h1 style="margin: 0 0 16px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: bold; color: #243A2D; line-height: 1.3;">
                ${escapeHtml(title)}
              </h1>

              <!-- Recipe Cover Image -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(recipeUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block;">
                      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}" width="516" style="width: 100%; max-width: 516px; height: auto; aspect-ratio: 16/9; object-fit: cover; border-radius: 12px; display: block; border: 1px solid #E7DFD3;" />
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Description -->
              <p style="margin: 0 0 20px 0; font-size: 15px; color: #44403C; line-height: 1.6;">
                ${escapeHtml(description)}
              </p>

              <!-- Cooking Meta Table -->
              ${(prepText || cookText || params.servings) ? `
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px 0; background-color: #FAF6EE; border: 1px solid #E7DFD3; border-radius: 8px;">
                <tr>
                  ${prepText ? `<td style="padding: 12px 16px; font-size: 13px; color: #243A2D; text-align: center;"><strong>Prep:</strong> ${escapeHtml(prepText)}</td>` : ''}
                  ${cookText ? `<td style="padding: 12px 16px; font-size: 13px; color: #243A2D; text-align: center; ${prepText ? 'border-left: 1px solid #E7DFD3;' : ''}"><strong>Cook:</strong> ${escapeHtml(cookText)}</td>` : ''}
                  ${params.servings ? `<td style="padding: 12px 16px; font-size: 13px; color: #243A2D; text-align: center; ${(prepText || cookText) ? 'border-left: 1px solid #E7DFD3;' : ''}"><strong>Servings:</strong> ${params.servings}</td>` : ''}
                </tr>
              </table>` : ''}

              <!-- CTA Button -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 24px 0 16px 0;">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: #C66A45;">
                    <a href="${escapeHtml(recipeUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 10px; letter-spacing: 0.2px;">
                      View Full Recipe & Instructions →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 20px 0 0 0; font-size: 13px; color: #78716C; line-height: 1.5;">
                Happy slow cooking,<br>
                <strong style="color: #243A2D;">The CrockBites Team</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAF6EE; padding: 24px 32px; border-top: 1px solid #E7DFD3; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #78716C; line-height: 1.5;">
                Sent with care from <strong>CrockBites</strong> · Easy Slow Cooker Recipes & Everyday Meals<br>
                <a href="https://crockbites.site" style="color: #243A2D; text-decoration: underline; font-weight: 600;">crockbites.site</a>
              </p>
              <p style="margin: 12px 0 0 0; font-size: 11px; color: #A8A29E; line-height: 1.5;">
                You received this email because you subscribed to recipe updates from CrockBites.<br>
                <a href="{{ unsubscribe }}" style="color: #78716C; text-decoration: underline;">Unsubscribe</a> · 
                <a href="{{ mirror }}" style="color: #78716C; text-decoration: underline;">View in browser</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `CrockBites — Good Food. Less Fuss.
New Recipe: ${title}

${description}

${prepText ? `Prep Time: ${prepText}\n` : ''}${cookText ? `Cook Time: ${cookText}\n` : ''}${params.servings ? `Servings: ${params.servings}\n` : ''}
Get the complete recipe, ingredient list, and step-by-step instructions here:
${recipeUrl}

--
Sent with care from CrockBites (https://crockbites.site)
To unsubscribe from future recipe emails: {{ unsubscribe }}
`;

  return { subject, html, text };
}

/**
 * Retrieves the notification status record for a given recipe slug from the D1 database.
 */
export async function getRecipeNewsletterRecord(
  db: D1Database | null,
  slug: string,
): Promise<RecipeNewsletterRecord | null> {
  if (!db || !slug) return null;
  try {
    const row = await db
      .prepare('SELECT * FROM recipe_newsletter_notifications WHERE recipe_slug = ?')
      .bind(slug)
      .first<RecipeNewsletterRecord>();
    return row ?? null;
  } catch (err) {
    console.error('[CrockBites Brevo Campaign] Error querying notification log:', err);
    return null;
  }
}

/**
 * Triggers a Brevo email campaign for a newly published recipe.
 * - Enforces idempotency (each recipe receives at most one campaign).
 * - Target list: ID 3 (CrockBites Newsletter Subscribers).
 * - Safe error handling: never throws; records failures in D1.
 * - Supports dryRun mode for development and automated testing without contacting Brevo.
 */
export async function triggerRecipeNewsletterCampaign(
  db: D1Database | null,
  params: RecipeNotificationParams,
  options?: {
    dryRun?: boolean;
    forceSend?: boolean;
  },
): Promise<RecipeNotificationResult> {
  const slug = (params.slug || '').trim();
  const title = (params.title || '').trim();

  if (!slug || !title) {
    return { ok: false, status: 'failed', error: 'Missing required recipe slug or title.' };
  }

  // 1. Check idempotency in D1
  if (db) {
    try {
      const existing = await getRecipeNewsletterRecord(db, slug);
      if (existing && existing.status === 'sent' && !options?.forceSend) {
        return {
          ok: true,
          status: 'skipped',
          reason: 'already_sent',
          campaignId: existing.campaign_id || undefined,
        };
      }
    } catch (err) {
      console.warn('[CrockBites Brevo Campaign] Warning checking idempotency in D1:', err);
    }
  }

  const dryRun = Boolean(
    options?.dryRun ||
    getRuntimeSecret('BREVO_DRY_RUN') === 'true' ||
    process.env.NODE_ENV === 'test'
  );

  const apiKey = getRuntimeSecret('BREVO_API_KEY');
  const now = new Date().toISOString();
  const recordId = `nl_${slug}_${Date.now()}`;

  // If API key is missing and not dry-run
  if (!apiKey && !dryRun) {
    const errorMsg = 'Brevo Campaign API key is missing (BREVO_API_KEY secret needed).';
    if (db) {
      try {
        await db
          .prepare(
            `INSERT INTO recipe_newsletter_notifications 
             (id, recipe_slug, recipe_title, status, list_id, error_message, created_at, updated_at)
             VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)
             ON CONFLICT(recipe_slug) DO UPDATE SET 
               status = 'failed', 
               error_message = excluded.error_message, 
               updated_at = excluded.updated_at`
          )
          .bind(recordId, slug, title, DEFAULT_NEWSLETTER_LIST_ID, errorMsg, now, now)
          .run();
      } catch (dbErr) {
        console.error('[CrockBites Brevo Campaign] Failed to record failure state:', dbErr);
      }
    }
    return { ok: false, status: 'failed', error: errorMsg };
  }

  // Render email content
  const rendered = renderRecipeNewsletterEmail(params);

  // If in dry-run mode (used during testing / safe development)
  if (dryRun) {
    const mockCampaignId = `mock_camp_${slug}_${Date.now()}`;
    if (db) {
      try {
        await db
          .prepare(
            `INSERT INTO recipe_newsletter_notifications 
             (id, recipe_slug, recipe_title, campaign_id, status, list_id, recipient_count, created_at, sent_at, updated_at)
             VALUES (?, ?, ?, ?, 'sent', ?, 1, ?, ?, ?)
             ON CONFLICT(recipe_slug) DO UPDATE SET 
               status = 'sent', 
               campaign_id = excluded.campaign_id, 
               sent_at = excluded.sent_at, 
               updated_at = excluded.updated_at`
          )
          .bind(recordId, slug, title, mockCampaignId, DEFAULT_NEWSLETTER_LIST_ID, now, now, now)
          .run();
      } catch (dbErr) {
        console.error('[CrockBites Brevo Campaign] Failed to write mock campaign in DB:', dbErr);
      }
    }
    return {
      ok: true,
      status: 'sent',
      campaignId: mockCampaignId,
      dryRun: true,
    };
  }

  // 2. Real Brevo API Interaction
  // Step 2a: Create Campaign
  let campaignId = '';
  try {
    // Record pending status in DB
    if (db) {
      await db
        .prepare(
          `INSERT INTO recipe_newsletter_notifications 
           (id, recipe_slug, recipe_title, status, list_id, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?)
           ON CONFLICT(recipe_slug) DO UPDATE SET 
             status = 'pending', 
             updated_at = excluded.updated_at`
        )
        .bind(recordId, slug, title, DEFAULT_NEWSLETTER_LIST_ID, now, now)
        .run();
    }

    const campaignPayload = {
      name: `New Recipe: ${title.slice(0, 100)} (${slug}) - ${Date.now()}`,
      subject: rendered.subject,
      sender: DEFAULT_BREVO_SENDER,
      type: 'classic',
      htmlContent: rendered.html,
      recipients: {
        listIds: [DEFAULT_NEWSLETTER_LIST_ID],
      },
    };

    const createRes = await fetch(BREVO_CAMPAIGNS_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(campaignPayload),
    });

    const createData = (await createRes.json().catch(() => ({}))) as Record<string, unknown>;

    if (!createRes.ok || !createData?.id) {
      const errorMsg =
        typeof createData?.message === 'string'
          ? createData.message
          : `Brevo create campaign API returned HTTP ${createRes.status}`;

      if (db) {
        await db
          .prepare(
            `UPDATE recipe_newsletter_notifications 
             SET status = 'failed', error_message = ?, updated_at = ? 
             WHERE recipe_slug = ?`
          )
          .bind(errorMsg, new Date().toISOString(), slug)
          .run();
      }

      return { ok: false, status: 'failed', error: errorMsg };
    }

    campaignId = String(createData.id);

    // Step 2b: Send Campaign Immediately (`sendNow`)
    const sendNowUrl = `${BREVO_CAMPAIGNS_API_URL}/${encodeURIComponent(campaignId)}/sendNow`;
    const sendRes = await fetch(sendNowUrl, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        Accept: 'application/json',
      },
    });

    if (!sendRes.ok && sendRes.status !== 204) {
      const sendData = (await sendRes.json().catch(() => ({}))) as Record<string, unknown>;
      const errorMsg =
        typeof sendData?.message === 'string'
          ? sendData.message
          : `Brevo sendNow API returned HTTP ${sendRes.status}`;

      if (db) {
        await db
          .prepare(
            `UPDATE recipe_newsletter_notifications 
             SET campaign_id = ?, status = 'failed', error_message = ?, updated_at = ? 
             WHERE recipe_slug = ?`
          )
          .bind(campaignId, errorMsg, new Date().toISOString(), slug)
          .run();
      }

      return { ok: false, status: 'failed', campaignId, error: errorMsg };
    }

    // Step 2c: Update DB with successful dispatch
    const sentAt = new Date().toISOString();
    if (db) {
      await db
        .prepare(
          `UPDATE recipe_newsletter_notifications 
           SET campaign_id = ?, status = 'sent', error_message = NULL, sent_at = ?, updated_at = ? 
           WHERE recipe_slug = ?`
        )
        .bind(campaignId, sentAt, sentAt, slug)
        .run();
    }

    return {
      ok: true,
      status: 'sent',
      campaignId,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[CrockBites Brevo Campaign] Unexpected error triggering campaign:', err);

    if (db) {
      try {
        await db
          .prepare(
            `UPDATE recipe_newsletter_notifications 
             SET status = 'failed', error_message = ?, updated_at = ? 
             WHERE recipe_slug = ?`
          )
          .bind(errorMsg, new Date().toISOString(), slug)
          .run();
      } catch {}
    }

    return { ok: false, status: 'failed', campaignId: campaignId || undefined, error: errorMsg };
  }
}


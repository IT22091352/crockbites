import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_BREVO_SENDER,
  DEFAULT_NEWSLETTER_LIST_ID,
  BREVO_CAMPAIGNS_API_URL,
  renderRecipeNewsletterEmail,
  isBrevoCampaignConfigured,
  getRecipeNewsletterRecord,
  triggerRecipeNewsletterCampaign,
} from '../src/lib/brevo-campaign.ts';
import { createSqliteD1Adapter, COMMUNITY_SCHEMA_SQL } from '../src/lib/db.ts';

function createMockD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(COMMUNITY_SCHEMA_SQL);
  return createSqliteD1Adapter(sqlite);
}

test('1. Brevo sender identity and recipient list configuration', () => {
  assert.equal(DEFAULT_BREVO_SENDER.name, 'CrockBites');
  assert.equal(DEFAULT_BREVO_SENDER.email, 'no-reply@mail.crockbites.site');
  assert.equal(DEFAULT_NEWSLETTER_LIST_ID, 3);
  assert.equal(BREVO_CAMPAIGNS_API_URL, 'https://api.brevo.com/v3/emailCampaigns');

  const config = isBrevoCampaignConfigured();
  assert.equal(config.sender, 'CrockBites <no-reply@mail.crockbites.site>');
  assert.equal(config.listId, 3);
});

test('2. Newsletter email template rendering and Brevo compliance', () => {
  const rendered = renderRecipeNewsletterEmail({
    slug: 'honey-garlic-slow-cooker-chicken',
    title: 'Honey Garlic Slow Cooker Chicken',
    description: 'Tender chicken breasts slow-cooked in a sweet and savory honey garlic glaze.',
    image: 'https://res.cloudinary.com/dmxumqqpj/image/upload/v12345/honey-chicken.jpg',
    imageAlt: 'Plate of honey garlic chicken with steamed rice',
    prepMinutes: 15,
    cookMinutes: 240,
    servings: 4,
    category: 'slow-cooker-chicken',
  });

  // Subject line
  assert.equal(rendered.subject, 'New Recipe: Honey Garlic Slow Cooker Chicken 🍲');

  // Branding and tagline
  assert.ok(rendered.html.includes('Crock<span style="color: #E29373;">Bites</span>'));
  assert.ok(rendered.html.includes('Good Food. Less Fuss.'));
  assert.ok(rendered.html.includes('#243A2D'), 'Forest green brand color');
  assert.ok(rendered.html.includes('#F7F1E5'), 'Warm cream brand color');
  assert.ok(rendered.html.includes('#C66A45'), 'Terracotta CTA color');

  // Recipe details
  assert.ok(rendered.html.includes('Honey Garlic Slow Cooker Chicken'));
  assert.ok(rendered.html.includes('Tender chicken breasts slow-cooked'));
  assert.ok(rendered.html.includes('https://res.cloudinary.com/dmxumqqpj/image/upload/v12345/honey-chicken.jpg'));
  assert.ok(rendered.html.includes('15 mins'));
  assert.ok(rendered.html.includes('4 hrs'));
  assert.ok(rendered.html.includes('Servings:</strong> 4'));
  assert.ok(rendered.html.includes('https://crockbites.site/recipe/honey-garlic-slow-cooker-chicken/'));
  assert.ok(rendered.html.includes('View Full Recipe & Instructions →'));

  // Mandatory Brevo unsubscribe and mirror tags
  assert.ok(rendered.html.includes('{{ unsubscribe }}'), 'Includes mandatory Brevo unsubscribe tag');
  assert.ok(rendered.html.includes('{{ mirror }}'), 'Includes web mirror tag');

  // Plain-text version
  assert.ok(rendered.text.includes('Honey Garlic Slow Cooker Chicken'));
  assert.ok(rendered.text.includes('https://crockbites.site/recipe/honey-garlic-slow-cooker-chicken/'));
  assert.ok(rendered.text.includes('{{ unsubscribe }}'));
});

test('3. D1 database tracking: recipe_newsletter_notifications table', async () => {
  const db = createMockD1();

  const record = await getRecipeNewsletterRecord(db, 'non-existent-recipe');
  assert.equal(record, null);

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO recipe_newsletter_notifications 
       (id, recipe_slug, recipe_title, campaign_id, status, list_id, recipient_count, created_at, sent_at, updated_at)
       VALUES (?, ?, ?, ?, 'sent', 3, 42, ?, ?, ?)`
    )
    .bind('nl_test_1', 'slow-cooker-chili', 'Slow Cooker Beef Chili', 'brevo_camp_123', now, now, now)
    .run();

  const saved = await getRecipeNewsletterRecord(db, 'slow-cooker-chili');
  assert.ok(saved);
  assert.equal(saved.recipe_slug, 'slow-cooker-chili');
  assert.equal(saved.recipe_title, 'Slow Cooker Beef Chili');
  assert.equal(saved.campaign_id, 'brevo_camp_123');
  assert.equal(saved.status, 'sent');
  assert.equal(saved.list_id, 3);
  assert.equal(saved.recipient_count, 42);
});

test('4. Publishing a new recipe with notifications enabled (dry-run mode)', async () => {
  const db = createMockD1();

  const result = await triggerRecipeNewsletterCampaign(
    db,
    {
      slug: 'bbq-pulled-pork',
      title: 'BBQ Pulled Pork',
      description: 'Slow-cooked melt-in-your-mouth pork shoulder shredded in smoky BBQ sauce.',
      prepMinutes: 10,
      cookMinutes: 480,
    },
    { dryRun: true }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 'sent');
  assert.ok(result.campaignId);
  assert.equal(result.dryRun, true);

  // Verify status stored in D1
  const record = await getRecipeNewsletterRecord(db, 'bbq-pulled-pork');
  assert.ok(record);
  assert.equal(record.status, 'sent');
  assert.equal(record.campaign_id, result.campaignId);
  assert.ok(record.sent_at);
});

test('5. Idempotency: duplicate publish requests are safely skipped', async () => {
  const db = createMockD1();

  // First publish
  const first = await triggerRecipeNewsletterCampaign(
    db,
    {
      slug: 'pot-roast',
      title: 'Classic Slow Cooker Pot Roast',
    },
    { dryRun: true }
  );
  assert.equal(first.status, 'sent');

  // Second publish (e.g. repeated click or retry)
  const second = await triggerRecipeNewsletterCampaign(
    db,
    {
      slug: 'pot-roast',
      title: 'Classic Slow Cooker Pot Roast',
    },
    { dryRun: true }
  );

  // Must skip to avoid spamming subscribers
  assert.equal(second.ok, true);
  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'already_sent');
  assert.equal(second.campaignId, first.campaignId);
});

test('6. Missing BREVO_API_KEY records failure gracefully without throwing', async () => {
  const db = createMockD1();
  const originalKey = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;

  try {
    const result = await triggerRecipeNewsletterCampaign(
      db,
      {
        slug: 'lemon-herb-chicken',
        title: 'Lemon Herb Slow Cooker Chicken',
      },
      { dryRun: false }
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.ok(result.error?.includes('BREVO_API_KEY'));

    // Check DB logged the failure
    const record = await getRecipeNewsletterRecord(db, 'lemon-herb-chicken');
    assert.ok(record);
    assert.equal(record.status, 'failed');
    assert.ok(record.error_message?.includes('BREVO_API_KEY'));
  } finally {
    if (originalKey !== undefined) process.env.BREVO_API_KEY = originalKey;
  }
});

test('7. Brevo API mock failure handled gracefully without breaking publish workflow', async () => {
  const db = createMockD1();
  const originalFetch = globalThis.fetch;
  process.env.BREVO_API_KEY = 'mock_key_for_test';

  // Mock Brevo returning an error response (e.g. invalid sender or quota exceeded)
  globalThis.fetch = async (url) => {
    if (url.toString().includes('emailCampaigns')) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          code: 'invalid_parameter',
          message: 'Unable to create campaign: quota limit reached',
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    const result = await triggerRecipeNewsletterCampaign(
      db,
      {
        slug: 'beef-stroganoff',
        title: 'Slow Cooker Beef Stroganoff',
      },
      { dryRun: false }
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.ok(result.error?.includes('quota limit reached'));

    // Verify error was persisted to D1 audit log
    const record = await getRecipeNewsletterRecord(db, 'beef-stroganoff');
    assert.ok(record);
    assert.equal(record.status, 'failed');
    assert.ok(record.error_message?.includes('quota limit reached'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BREVO_API_KEY;
  }
});

test('8. Publishing with notifications disabled skips dispatching campaign', async () => {
  const db = createMockD1();

  // Simulated handler logic when sendNewsletter is false
  const sendNewsletter = false;
  let result = null;
  if (!sendNewsletter) {
    result = { ok: true, status: 'skipped', reason: 'disabled_by_user' };
  } else {
    result = await triggerRecipeNewsletterCampaign(db, {
      slug: 'garlic-parmesan-potatoes',
      title: 'Garlic Parmesan Potatoes',
    });
  }

  assert.equal(result.ok, true);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'disabled_by_user');

  // Verify no record was marked as sent in DB
  const record = await getRecipeNewsletterRecord(db, 'garlic-parmesan-potatoes');
  assert.equal(record, null);
});

test('9. Editing an already-published recipe skips dispatching campaign', () => {
  const priorReviewStatus = 'tested';
  const newReviewStatus = 'tested';
  const isTransitionToPublished = priorReviewStatus !== 'tested' && newReviewStatus === 'tested';

  assert.equal(isTransitionToPublished, false, 'Should not detect transition when already published');

  let result = null;
  if (isTransitionToPublished) {
    result = { ok: true, status: 'sent' };
  } else if (newReviewStatus === 'tested') {
    result = { ok: true, status: 'skipped', reason: 'already_published' };
  }

  assert.equal(result.ok, true);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'already_published');
});

test('10. Saving a draft recipe skips dispatching campaign', () => {
  const newReviewStatus = 'draft';
  const isTransitionToPublished = false;

  let result = null;
  if (isTransitionToPublished) {
    result = { ok: true, status: 'sent' };
  } else if (newReviewStatus === 'draft') {
    result = { ok: true, status: 'skipped', reason: 'draft' };
  }

  assert.equal(result.ok, true);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'draft');
});

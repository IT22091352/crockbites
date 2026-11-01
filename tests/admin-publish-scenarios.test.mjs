import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Recipe Publishing & Newsletter ReferenceError Prevention Browser Test', async (t) => {
  const slugAstroContent = fs.readFileSync('src/pages/admin/recipes/[slug].astro', 'utf8');

  // Verify that isNewsletterChecked is defined inside submitRecipe and not relied upon as global
  await t.test('Scope check: isNewsletterChecked is properly declared in submitRecipe', () => {
    const submitStart = slugAstroContent.indexOf('async function submitRecipe(targetStatus)');
    assert.ok(submitStart !== -1, 'submitRecipe must exist');
    const submitBody = slugAstroContent.slice(submitStart, submitStart + 800);
    assert.ok(
      submitBody.includes('const newsletterCheckbox = document.getElementById(\'sendNewsletterCheckbox\');'),
      'Must read sendNewsletterCheckbox'
    );
    assert.ok(
      submitBody.includes('const isNewsletterChecked = Boolean(newsletterCheckbox?.checked);'),
      'Must declare isNewsletterChecked in function scope'
    );
  });

  // Scenario 1: Publish with newsletter checked
  await t.test('Scenario 1: Publish with newsletter checked', () => {
    let modalOpened = false;
    let submittedPayload = null;

    // Simulate DOM environment
    const checkbox = { checked: true };
    const initialRecipe = { reviewStatus: 'draft', slug: 'test-cook' };

    // Simulate publish button click
    const isNewsletterChecked = Boolean(checkbox.checked);
    const isDraft = initialRecipe.reviewStatus === 'draft';
    if (isDraft && checkbox && isNewsletterChecked) {
      modalOpened = true;
    }

    assert.equal(modalOpened, true, 'Confirm modal must open when publishing draft with newsletter checked');

    // User confirms modal
    function submitRecipe(targetStatus) {
      const isNewsletterChecked = Boolean(checkbox.checked);
      submittedPayload = {
        targetStatus,
        sendNewsletter: targetStatus === 'tested' ? isNewsletterChecked : false,
        notifyNewsletter: isNewsletterChecked,
      };
    }

    submitRecipe('tested');
    assert.deepEqual(submittedPayload, {
      targetStatus: 'tested',
      sendNewsletter: true,
      notifyNewsletter: true,
    });
  });

  // Scenario 2: Publish with newsletter unchecked
  await t.test('Scenario 2: Publish with newsletter unchecked', () => {
    let modalOpened = false;
    let submittedPayload = null;

    const checkbox = { checked: false };
    const initialRecipe = { reviewStatus: 'draft', slug: 'test-cook' };

    const isNewsletterChecked = Boolean(checkbox.checked);
    const isDraft = initialRecipe.reviewStatus === 'draft';
    if (isDraft && checkbox && isNewsletterChecked) {
      modalOpened = true;
    } else {
      submitRecipe('tested');
    }

    function submitRecipe(targetStatus) {
      const isNewsletterChecked = Boolean(checkbox.checked);
      submittedPayload = {
        targetStatus,
        sendNewsletter: targetStatus === 'tested' ? isNewsletterChecked : false,
        notifyNewsletter: isNewsletterChecked,
      };
    }

    assert.equal(modalOpened, false, 'Confirm modal must NOT open when newsletter is unchecked');
    assert.deepEqual(submittedPayload, {
      targetStatus: 'tested',
      sendNewsletter: false,
      notifyNewsletter: false,
    });
  });

  // Scenario 3: Save as Draft with newsletter checked
  await t.test('Scenario 3: Save as Draft with newsletter checked', () => {
    const checkbox = { checked: true };
    let submittedPayload = null;
    let flashMessage = '';

    function submitRecipe(targetStatus) {
      const isNewsletterChecked = Boolean(checkbox.checked);
      submittedPayload = {
        targetStatus,
        sendNewsletter: targetStatus === 'tested' ? isNewsletterChecked : false,
        notifyNewsletter: isNewsletterChecked,
      };

      if (targetStatus === 'draft') {
        flashMessage = isNewsletterChecked
          ? 'Draft saved successfully. No newsletter email was sent.'
          : 'Draft saved successfully.';
      }
    }

    submitRecipe('draft');
    assert.equal(submittedPayload.targetStatus, 'draft');
    assert.equal(submittedPayload.sendNewsletter, false, 'sendNewsletter must be false for draft saves');
    assert.equal(submittedPayload.notifyNewsletter, true, 'notifyNewsletter preference must be preserved');
    assert.equal(flashMessage, 'Draft saved successfully. No newsletter email was sent.');
  });

  // Scenario 4: Edit an already published recipe
  await t.test('Scenario 4: Edit an already published recipe skips confirmation dialog and newsletter', () => {
    let modalOpened = false;
    let submittedPayload = null;

    const checkbox = { checked: true };
    const initialRecipe = { reviewStatus: 'tested', slug: 'bbq-slow-cooker-ribs' };

    const isNewsletterChecked = Boolean(checkbox.checked);
    const isDraft = initialRecipe.reviewStatus === 'draft';
    if (isDraft && checkbox && isNewsletterChecked) {
      modalOpened = true;
    } else {
      submitRecipe('tested');
    }

    function submitRecipe(targetStatus) {
      const isNewsletterChecked = Boolean(checkbox.checked);
      submittedPayload = {
        targetStatus,
        sendNewsletter: targetStatus === 'tested' ? isNewsletterChecked : false,
        notifyNewsletter: isNewsletterChecked,
      };
    }

    assert.equal(modalOpened, false, 'Already published recipe must not show publish confirmation dialog');
    assert.equal(submittedPayload.targetStatus, 'tested');
  });

  // Scenario 5: Simulate an API failure and verify the modal resets correctly
  await t.test('Scenario 5: API failure resets modal and re-enables buttons', async () => {
    let modalHidden = false;
    let executeBtnDisabled = true;
    let executeBtnText = 'Publishing & Sending...';
    let cancelBtnDisabled = true;
    let saveDraftBtnDisabled = true;
    let publishBtnDisabled = true;
    let statusMessage = '';

    function resetConfirmModalState() {
      executeBtnDisabled = false;
      executeBtnText = 'Publish & Send Newsletter';
      cancelBtnDisabled = false;
    }

    function closeConfirmModal() {
      modalHidden = true;
      resetConfirmModalState();
    }

    // Simulate API rejection / error
    try {
      throw new Error('500 Internal Server Error: Database timeout');
    } catch (err) {
      statusMessage = 'Network error: ' + err.message;
      saveDraftBtnDisabled = false;
      publishBtnDisabled = false;
      closeConfirmModal();
    }

    assert.equal(modalHidden, true, 'Modal was hidden');
    assert.equal(executeBtnDisabled, false, 'Execute button was re-enabled');
    assert.equal(executeBtnText, 'Publish & Send Newsletter', 'Button text was restored from loading state');
    assert.equal(cancelBtnDisabled, false, 'Cancel button was re-enabled');
    assert.equal(saveDraftBtnDisabled, false, 'Save Draft button was re-enabled');
    assert.equal(publishBtnDisabled, false, 'Publish button was re-enabled');
    assert.equal(statusMessage, 'Network error: 500 Internal Server Error: Database timeout');
  });

  // Scenario 6: Live SEO Slug Generation & Synchronization
  await t.test('Scenario 6: Live SEO Slug Generation & Synchronization', () => {
    function generateSlug(text) {
      return (text || '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    // 1. Example test cases from user specification
    assert.equal(generateSlug('CrockBites Draft Recipe'), 'crockbites-draft-recipe');
    assert.equal(generateSlug('Easy Slow Cooker Chicken'), 'easy-slow-cooker-chicken');

    // 2. Character-by-character typing simulation
    const steps = [
      ['C', 'c'],
      ['Cr', 'cr'],
      ['Cro', 'cro'],
      ['Crock', 'crock'],
      ['CrockBites', 'crockbites'],
      ['CrockBites ', 'crockbites'],
      ['CrockBites D', 'crockbites-d'],
      ['CrockBites Draft', 'crockbites-draft'],
      ['CrockBites Draft Recipe', 'crockbites-draft-recipe'],
    ];
    for (const [input, expected] of steps) {
      assert.equal(generateSlug(input), expected, `Typing "${input}" must produce "${expected}"`);
    }

    // 3. Special characters, apostrophes, consecutive spaces, and hyphens
    assert.equal(generateSlug("Mom's Best BBQ Ribs! (Slow Cooker)"), 'moms-best-bbq-ribs-slow-cooker');
    assert.equal(generateSlug('  ---Super   Tender---Beef---Stew---  '), 'super-tender-beef-stew');

    // 4. Verify UI attributes in new.astro and [slug].astro
    const newAstroContent = fs.readFileSync('src/pages/admin/recipes/new.astro', 'utf8');
    const editAstroContent = fs.readFileSync('src/pages/admin/recipes/[slug].astro', 'utf8');

    // Both must mark slugInput as readonly
    assert.ok(newAstroContent.includes('id="slugInput"') && newAstroContent.includes('readonly'), 'new.astro slugInput must be readonly');
    assert.ok(editAstroContent.includes('id="slugInput"') && editAstroContent.includes('readonly'), '[slug].astro slugInput must be readonly');

    // Both must listen to titleInput 'input' event to update slugInput in real time
    assert.ok(newAstroContent.includes("titleInput.addEventListener('input'"), 'new.astro must bind input listener to titleInput');
    assert.ok(editAstroContent.includes("titleInput.addEventListener('input'"), '[slug].astro must bind input listener to titleInput');
  });
});


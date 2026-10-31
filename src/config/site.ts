/**
 * Central site configuration. Everything that is "unknown until you have it"
 * (AdSense, analytics, Search Console, newsletter provider) is read from
 * environment variables and is empty by default, so nothing fake ships.
 */
const env = import.meta.env;

export const site = {
  name: 'CrockBites',
  tagline: 'Good Food. Less Fuss.',
  url: 'https://crockbites.site',
  homeTitle: 'CrockBites — Easy Slow Cooker Recipes & Everyday Meals',
  description:
    'Easy slow cooker recipes and everyday meals made for real life. Practical ingredient lists, clear steps, and food safety guidance.',
  locale: 'en_US',
  language: 'en-US',
  /** Contact address shown on the site. CHANGE THIS to a mailbox you actually control before launch. */
  contactEmail: 'hello@crockbites.com',
  /** Default social share image (1200x630). A branded PNG ships (rendered by scripts/build-icons.mjs); swap in your own artwork any time. */
  defaultOgImage: '/images/og-default.png',
  /**
   * While recipes are marked `reviewStatus: draft` they are shown with a visible
   * notice and told to search engines not to index them. Flip to true only if you
   * really want drafts indexed.
   */
  indexDraftRecipes: false,
  recipesPerPage: 12,

  ads: {
    /** e.g. "ca-pub-XXXXXXXXXXXXXXXX" — only set after AdSense approval. */
    client: (env.PUBLIC_ADSENSE_CLIENT as string | undefined) || '',
    /** Master switch. Ads render only if this is true AND a client id exists AND the slot id exists. */
    enabled: false,
    /** Ad unit ids created in your AdSense account. Keep empty until then. */
    slots: {
      homeMid: '',
      listingMid: '',
      recipeAfterIntro: '',
      recipeAfterCard: '',
    } as Record<string, string>,
  },

  analytics: {
    /** e.g. "G-XXXXXXXXXX" — leave empty until you create a GA4 property. */
    gaMeasurementId: (env.PUBLIC_GA_MEASUREMENT_ID as string | undefined) || '',
    /** Google Search Console HTML-tag verification token (the content value only). */
    gscVerification: (env.PUBLIC_GSC_VERIFICATION as string | undefined) || '',
  },

  newsletter: {
    /** Form action URL from a real provider (Buttondown, MailerLite, ConvertKit...). Empty = placeholder mode. */
    formAction: (env.PUBLIC_NEWSLETTER_FORM_ACTION as string | undefined) || '',
  },

  /** Add real profile URLs only when the accounts exist. They feed Organization `sameAs`. */
  social: [] as { label: string; url: string }[],
};

# Google AdSense readiness checklist

AdSense approval is **not guaranteed**. Google decides, using its current program policies, which change over time. Read them before applying: support.google.com/adsense and the AdSense Program policies.

## Content and site quality (do these first)

- [ ] Every recipe has been cooked and checked by a person, and flipped to `reviewStatus: tested`.
- [ ] Placeholder illustrations are replaced with your own photographs, and `imageAlt` describes each real photo.
- [ ] You have enough original, useful content for your own standards. Google does not publish a fixed number of posts.
- [ ] No copied recipes or images. No fake reviews, ratings, testimonials or credentials.
- [ ] About, Contact, Privacy Policy, Terms and Cookies/Advertising pages are reviewed, filled in, and accurate. Remove every "[...]" placeholder.
- [ ] The contact email works.
- [ ] The site is live on your own domain (CrockBites.com), loads over HTTPS, and is crawlable (not blocked).
- [ ] Navigation works, there are no broken links (`npm run verify`), and the site is usable on mobile.

## Privacy and consent

- [ ] If you have visitors from the EEA, UK or Switzerland, set up a Google-certified consent management platform (CMP) before showing ads or loading analytics. Check Google's current requirements.
- [ ] Privacy policy and cookie page describe Google ads/analytics accurately once they are enabled.

## Technical steps after approval

1. Apply for AdSense with your domain and complete Google's site connection step. Google gives you a publisher id like `ca-pub-XXXXXXXXXXXXXXXX`. Never invent one.
2. Add the id as an environment variable `PUBLIC_ADSENSE_CLIENT` (Cloudflare Pages: Settings, Variables; locally: `.env`). `Seo.astro` then loads the official AdSense script, but only when `ads.enabled` is also `true`.
3. Create ad units in AdSense and put each unit id in `site.ads.slots` in `src/config/site.ts`:
   - `homeMid`: between sections on the homepage
   - `listingMid`: on recipe and category listings
   - `recipeAfterIntro`: after the recipe introduction, before the recipe card
   - `recipeAfterCard`: after the recipe card
4. Set `site.ads.enabled = true` in `src/config/site.ts` and redeploy.
5. Create `public/ads.txt` using the line Google shows in your account. The documented shape is `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0` with your real publisher id. A template is in `docs/ads.txt.example`. Do not commit an `ads.txt` with a fake id.
6. Check `https://crockbites.site/ads.txt` loads, then wait for AdSense to confirm it.

## How the placeholders behave

- `AdSlot.astro` renders nothing at all unless ads are enabled, a client id exists, and that slot has an id. No empty boxes, no fake ads.
- Ads are labelled "Advertisement", sit outside the ingredient list and instructions, and are hidden when printing.
- Do not add ads inside ingredient lists, steps, buttons or the serving selector, and do not encourage clicks. These break AdSense policies.

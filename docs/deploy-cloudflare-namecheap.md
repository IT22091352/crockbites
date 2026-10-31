# Deploying CrockBites to Cloudflare Pages and connecting CrockBites.com (Namecheap)

Nothing in this repository has been deployed, and the domain has **not** been connected. These are the steps you perform. Cloudflare and Namecheap change their dashboards from time to time, so treat button names as approximate and check their current docs.

## 1. Put the code in Git

1. Create a repository on GitHub (or GitLab).
2. From the project folder: `git init`, `git add .`, `git commit -m "Initial CrockBites site"`, then add the remote and push.

## 2. Create the Pages project

1. In the Cloudflare dashboard open **Workers & Pages**, choose **Create**, then the **Pages** tab, then **Connect to Git**, and pick the repository.
2. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Add an environment variable under **Settings, Variables and Secrets** (production and preview): `NODE_VERSION` = `22.23.4`. Astro 7 refuses to run on older Node versions, and `.nvmrc` alone may pick an older 22.x.
4. Save and deploy. You get a `*.pages.dev` address. Open it and check the site before touching DNS.

Direct upload alternative (no Git): run `npm run build`, then `npx wrangler pages deploy dist --project-name crockbites` after `npx wrangler login`.

Free-plan limits (builds per month, files per deployment, file size) change over time. Check Cloudflare's current "Pages limits" page. This site is a few dozen small files, so it should sit far below them.

## 3. Connect CrockBites.site

Cloudflare Pages needs the domain's DNS to be served by Cloudflare for an apex domain like `crockbites.site`, so the simplest route is to move the nameservers.

1. In Cloudflare, **Add a domain** (free plan) and enter `crockbites.site`. Let it scan existing DNS records; remove anything you do not recognize, and keep any email records (MX, SPF, DKIM) you actually use.
2. Cloudflare shows two nameservers (for example `xxx.ns.cloudflare.com`). Copy them.
3. In Namecheap: **Domain List, Manage** next to the domain, **Nameservers**, choose **Custom DNS**, paste the two Cloudflare nameservers, and save. If DNSSEC is enabled at Namecheap, turn it off first and re-enable it from Cloudflare later.
4. Wait for Cloudflare to report the domain as **Active**. This usually takes minutes to a few hours, sometimes up to 24-48 hours.
5. In your Pages project open **Custom domains, Set up a custom domain**, add `crockbites.site`, and accept the DNS record Cloudflare proposes. Repeat for `www.crockbites.site`.
6. Pick one canonical version. The site is configured for the bare domain (`https://crockbites.site`). Create a redirect from `www` to the bare domain (Rules, Redirect Rules, or a Bulk Redirect) so both do not compete in search.
7. In **SSL/TLS** use **Full** or **Full (strict)** and turn on **Always Use HTTPS**.
8. If you pick `www` as canonical instead, change `site.url` in `src/config/site.ts` and `site` in `astro.config.mjs`, then redeploy.

## 4. Email on the domain

The site shows `hello@crockbites.com` as its contact address (change it in `src/config/site.ts`). That mailbox does not exist until you create it. Options include Cloudflare Email Routing (forwards to a mailbox you already own) or any email host. Do not publish the site with an address that bounces.

## 5. Google Search Console

1. Add the domain property at search.google.com/search-console (DNS TXT verification works well once DNS is on Cloudflare).
2. Submit `https://crockbites.site/sitemap.xml`.
3. Draft recipes are `noindex` and excluded from the sitemap until you mark them `reviewStatus: tested`, so expect the sitemap to list only the non-recipe pages at first.
4. Indexing and ranking are decided by Google. Nothing here can promise them.

## 6. After each content change

Commit and push. Cloudflare rebuilds automatically. Preview deployments are created for other branches.

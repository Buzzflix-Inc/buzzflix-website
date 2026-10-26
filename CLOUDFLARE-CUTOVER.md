# Move buzzflix.ca from Squarespace to Cloudflare Pages

This moves the website to Cloudflare Pages and leaves everything else where it is. The domain stays registered with **Internic.ca**, and email stays on **Google Workspace**. Cloudflare publishes the site from the **jackbuzzflix/static** GitHub repository: every push to `main` updates the live site.

The Squarespace site keeps running until step 6, so you can roll back at any point before you cancel it.

## Current setup (checked 26 October 2026)

| Record | Name | Value | Purpose | After the move |
|---|---|---|---|---|
| A ×4 | `buzzflix.ca` | `198.185.159.144`, `198.185.159.145`, `198.49.23.144`, `198.49.23.145` | Squarespace website | Replaced in step 4 |
| CNAME | `www` | `ext-cust.squarespace.com` | Squarespace website | Replaced in step 4 |
| MX | `buzzflix.ca` | `smtp.google.com`, priority `30` | **Google Workspace email** | **Keep exactly** |
| TXT | `buzzflix.ca` | `google-site-verification=vmloblysCjQQF18Qs20u-qRWJvti8Aj_bxW-heW4r7E` | Google verification | **Keep exactly** |

- **Registrar and DNS:** Internic.ca (`dns.internic.ca`, `dns2.internic.ca`). The registration renews on 8 October 2027.
- **Main address:** `https://www.buzzflix.ca`. Visits to `buzzflix.ca` redirect to `www`. The new setup keeps this, so search results and shared links stay valid.
- **Live pages:** `/`, `/home`, `/movies`, `/mentors` and `/about`.

A public lookup can't list every DNS record. Log in to Internic and write down **every** record shown there before you start. Anything not in the table above must also be copied to Cloudflare.

## Before you start

1. **Export anything you need from Squarespace,** such as form submissions, newsletter contacts or analytics.
2. **Create a Cloudflare account** at dash.cloudflare.com. The **Free** plan is enough.

## 1. Connect the GitHub repository

1. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**. Choose the **Pages** option, not Workers.
2. Authorize the Cloudflare GitHub app. When GitHub asks which repositories it can access, choose **Only select repositories → jackbuzzflix/static**.
3. Use these settings:
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** `/`
4. Select **Save and Deploy**. Cloudflare gives the site a test address ending in `.pages.dev`.

## 2. Test the site on its .pages.dev address

Open these addresses on the `.pages.dev` site, on a computer and on a phone:

- [ ] `/` shows the homepage, with images and the mobile menu working
- [ ] `/movies`, `/mentors` and `/about` load and look right
- [ ] `/about.html` redirects to `/about`
- [ ] `/home` and `/home-applications` redirect to `/`
- [ ] `/no-such-page` shows the Buzzflix "page not found" page, not the homepage
- [ ] The links in the header and footer work

Nothing has changed for visitors yet. buzzflix.ca still shows Squarespace.

## 3. Move DNS management to Cloudflare

This changes where the domain's records are managed, not where they point. The website stays on Squarespace and email keeps working.

1. In Cloudflare, select **Add a domain**, enter `buzzflix.ca`, choose **Free**, and let it import the existing records.
2. Compare the imported records with the table above and with your Internic list. Add anything missing, especially the **MX** and **TXT** records.
3. Set the Squarespace **A** records and the **www CNAME** to **DNS only** (grey cloud) for now, so Squarespace keeps working exactly as it does today.
4. Cloudflare shows two nameservers, such as `xxx.ns.cloudflare.com`. In your Internic account, replace `dns.internic.ca` and `dns2.internic.ca` with those two. Change nothing else at Internic.
5. Wait for Cloudflare to show the domain as **Active**. This usually takes a few hours and can take up to 24.
6. Send an email to `info@buzzflix.ca` from an outside account, and send one back, to confirm email still works.

## 4. Point the website at Cloudflare Pages

Always add the domain in Pages **before** changing its DNS record. A record created by hand first can leave the site showing an error.

1. In DNS → Records, delete the **www CNAME** that points to `ext-cust.squarespace.com`.
2. Open the Pages project → **Custom domains → Set up a domain**, enter `www.buzzflix.ca` and confirm. Cloudflare creates the new record.
3. In DNS → Records, delete the four Squarespace **A** records for `buzzflix.ca`.
4. In **Custom domains**, add `buzzflix.ca` the same way.
5. Go to **Rules → Redirect Rules → Create rule** and use the **Redirect from root to WWW** template. Use status **301** and keep the query string. This keeps `www` as the main address, as it is on Squarespace.
6. Under **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**.

The website is only offline for the few minutes between deleting each old record and adding the domain in Pages. Do this step at a quiet time.

## 5. Check the live site

- [ ] `https://www.buzzflix.ca` shows the new site. Check in a private window on a computer and on a phone.
- [ ] `buzzflix.ca`, `http://buzzflix.ca` and `http://www.buzzflix.ca` all redirect to `https://www.buzzflix.ca/`
- [ ] `/about`, `/movies` and `/mentors` work, and `/home` redirects to `/`
- [ ] Unknown addresses show the "page not found" page
- [ ] Email to and from `info@buzzflix.ca` still works
- [ ] In Google Search Console, the site is still verified. Submit `https://www.buzzflix.ca/sitemap.xml`.

During application season, also send one clearly marked test application and check that it appears in the Google Sheet.

## 6. Cancel Squarespace

Wait about a week after step 5. Then, in Squarespace, remove the buzzflix.ca connection and cancel the website subscription. The domain isn't registered with Squarespace, so cancelling doesn't affect it.

## Recommended: email authentication

The domain has no SPF, DKIM or DMARC records yet. These confirm that email from `@buzzflix.ca` really comes from you, which keeps it out of spam folders. Add them in Cloudflare DNS once step 3 is done:

| Type | Name | Value |
|---|---|---|
| TXT | `buzzflix.ca` | `v=spf1 include:_spf.google.com ~all` |
| TXT | `google._domainkey` | Generate this in the Google Admin console under **Apps → Google Workspace → Gmail → Authenticate email**, then select **Start authentication** there. |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:info@buzzflix.ca` |

Only one SPF record is allowed. If you also send email through another service, its details go into this same record.

## If something goes wrong

- **The website breaks after step 4:** while Squarespace is still active, put the old records back in Cloudflare DNS: the four A records and `www` CNAME → `ext-cust.squarespace.com`, all set to **DNS only**.
- **Email breaks after step 3:** check that the MX record is exactly `smtp.google.com` with priority `30`. If you can't fix it quickly, set the nameservers at Internic back to `dns.internic.ca` and `dns2.internic.ca`.

## After the move

- **Publishing:** pushing a commit to `main` on GitHub publishes it within a minute or two. Changes pushed to another branch get their own preview address, and the live site is unaffected.
- **Application season:** run `node scripts/switch-home.mjs applications` (or `current` when applications close), then commit and push.
- **Redirects:** `_redirects` sends old Squarespace addresses and the homepage source pages to `/`. It also hides the setup documents in this repository from the public site.

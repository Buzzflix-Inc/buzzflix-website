# Connect the Buzzflix form to Google Sheets

No separate backend package or Google Cloud console setup is needed for this route. The website remains in preview mode until you paste in your Apps Script URL. Written applications are supported; video uploads and confirmation emails are still coming later.

## 1. Open Apps Script from your sheet

1. Open your **2027 Applications** Google Sheet while signed into your Buzzflix Workspace account.
2. In the sheet menu, click **Extensions → Apps Script**. A new tab opens.
3. Rename the script project at the top to **Buzzflix 2027 Applications**.
4. Click **Code.gs** in the left sidebar.
5. Remove its sample code. Open **apps-script/Code.gs** from this website folder, copy the entire file, and paste it into Google's Code.gs editor.
6. Click **Save** (the disk icon, or Ctrl+S / Command+S).

## 2. Run the one-time setup

1. In the function dropdown beside **Run**, select **setupApplications**.
2. Click **Run**.
3. If Google asks for authorization, click **Review permissions**, select your Workspace account, and allow this script to access spreadsheets. Only authorize the project you just created and populated with this code.
4. Wait for the execution to finish.
5. Return to the sheet. A tab named **Submission Records** should now exist with the correct column headings.

The setup remembers the sheet's ID privately in the script's settings. You do not need to copy it into the website. Keep **Submission Records** as a submission log; use a separate tab for sorted review views.

If you already created this tab, its first row must contain these exact headings in columns A through L:

`Submission ID`, `Submitted At`, `Name`, `Email`, `School`, `Previous Experience`, `Role 1`, `Role 2`, `Role 3`, `Additional Roles`, `Consent Version`, `Status`.

Setup will stop rather than overwrite different headings.

## 3. Deploy the script

1. Return to Apps Script. Click **Deploy → New deployment** at the top-right.
2. Click the gear beside **Select type**, then choose **Web app**.
3. Set **Description** to **Buzzflix 2027 applications**.
4. Set **Execute as** to **Me**, your Buzzflix account.
5. Set **Who has access** to **Anyone**. This lets applicants submit without a Google login. Do not choose an option requiring a Google account or organization membership.
6. Click **Deploy**. Approve any authorization prompt for your own script.
7. Copy the **Web app URL**, ending in **/exec**.

If **Anyone** is unavailable, your Workspace administrator needs to allow anonymous Apps Script web apps. Keep the spreadsheet private; making it public does not solve this restriction.

Open this URL in a private/incognito browser window. It should show `{"ready":true}` without asking you to sign in. This check does not expose any application data.

## 4. Connect the existing form

Open **assets/js/application-config.js** in your website folder. Paste the copied URL between the quotes:

```js
export const applicationEndpoint = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Save, then publish the updated website files through your existing GitHub workflow. The application page's button changes from **Preview submission** to **Submit application**.

Use the **Web app URL**, not the script editor URL or a test URL ending in `/dev`. Do not add `/applications` to the URL.

## 5. Test it

1. Open the homepage with the application form, preferably in a private/incognito window. `home-applications.html` isn't published on its own, so either switch the homepage to applications first, or push the switch to a separate GitHub branch and use that branch's Cloudflare preview address.
2. Submit clearly marked test information with three different roles.
3. Check that a row appears in **Submission Records** and the site confirms receipt.
4. Confirm the form does not promise a confirmation email or accept a video yet.

The browser sends the JSON answers as a plain-text POST so it does not require a CORS preflight. Apps Script reads the answers and returns JSON through Google's Content Service redirect. The form uses normal CORS and only displays success after reading an explicit saved response. It does not use `no-cors`, which would hide whether saving succeeded.

If the form reports an error, keep the answers and retry. If Google displays a login page or a browser blocks the response, verify the deployment is accessible to **Anyone**, its URL ends in `/exec`, and the private-window readiness check works. Check **Executions** in Apps Script for server failures. Do not treat a network request being sent as proof that the application was saved.

## Updating the script later

After editing Code.gs, save, then select **Deploy → Manage deployments → Edit** (pencil) → **Version: New version** → **Deploy**. This updates the existing deployment without changing the URL. Saving code alone does not update the public deployment.

To make applications the homepage, use the existing switch tool from your website folder:

```sh
node scripts/switch-home.mjs applications
```

Publish the changed homepage files. To restore the other homepage, use `node scripts/switch-home.mjs current`.

## Behavior and limits

The script checks required answers, email format, three distinct roles, consent, and answer lengths. It uses a script-wide lock and checks submission IDs before adding rows. Unchanged retries reuse the reference and do not create another row. Answers starting with formula-like characters are prefixed as text.

A hidden spam-trap field and a basic shared limit of 20 submissions per minute are included. The limit uses Google's cache, which can expire early. The public URL is not a secret and these protections do not replace CAPTCHA. Apps Script has Google-managed execution quotas; no separate paid backend is required for this text-only version.

The existing Cloud project and service account are no longer used by these website files. You do not need to delete them to use Apps Script. This change does not alter resources in your Google account.

Local checks: `node --test scripts/test-apps-script.mjs`. They simulate Google's services and do not submit real applications. A live browser test is still required after deployment.

Google documentation:
- [Deploy Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Content Service and redirects](https://developers.google.com/apps-script/guides/content)
- [Script locks](https://developers.google.com/apps-script/reference/lock/lock-service)

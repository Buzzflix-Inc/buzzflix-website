# Buzzflix 2027 application homepage

`home-applications.html` is the application-season clone. `home-current.html` is the other homepage snapshot. The active `index.html` remains unchanged until you switch them.

The form sends written applications to **2027 Applications** through Google Apps Script. Video uploads and confirmation emails are not enabled. The consent wording covers the written application.

## Setup

Follow **APPS-SCRIPT-SETUP.md**. Copy **apps-script/Code.gs** into the Apps Script editor opened from your sheet, run `setupApplications`, and deploy as a web app that executes as you and accepts **Anyone**.

Paste the deployed `/exec` URL into **assets/js/application-config.js**. An empty endpoint keeps preview mode: no data is sent and the confirmation identifies itself as a preview.

## Switch homepages

From the website folder:

```sh
node scripts/switch-home.mjs applications
```

This copies the application page to `index.html`. To switch back:

```sh
node scripts/switch-home.mjs current
```

Edit the named source pages before switching; the switch overwrites the active homepage file. Publish through your usual GitHub workflow.

## Submission contract

The browser POSTs a JSON string using `Content-Type: text/plain;charset=utf-8`. Fields are `name`, `email`, `school`, `experience`, `role_1`, `role_2`, `role_3`, `additional_roles`, `consent` (`agreed`), `consent_version` (`2027-text-v1`), `application_year` (`2027`), `submission_id` (UUID), and `website` (an empty spam-trap field).

After saving, the script returns JSON with `accepted:true`, `submissionId`, `duplicate`, and `confirmationEmailQueued:false`. Apps Script returns errors in JSON with `accepted:false` and a message, rather than a custom HTTP error status. The browser checks `accepted`, not just the HTTP status, and preserves answers on failure.

Update consent_version in both the form code and Code.gs if terms change. Video storage and email delivery require additional implementation.

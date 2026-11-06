// Where the application form sends applications and saved drafts: the site's own Worker (worker/apply.js).
// Leave empty to preview the page without sending any application data.
export const applicationEndpoint = '/api/apply';
// TEMPORARY for testing the staff area: off buzzflix.ca, the form really submits instead of previewing
// (the Worker also needs TEST_SUBMISSIONS in wrangler.jsonc). Set to false or delete before merging into main.
export const testSubmissions = true;

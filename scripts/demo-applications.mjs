// Made-up applications and teammates for trying the staff pages locally: DEMO=1 node scripts/serve.mjs
// None of these people are real.
const people = [
  ['Avery Tran', 'University of Windsor', 'Film, 3rd year', 'Director of Photography', 'Camera Operator', 'Editor'],
  ['Jordan Patel', 'St. Clair College', 'Broadcast, 2nd year', 'Production Sound Mixer', 'Boom Operator', 'Sound Editor'],
  ['Sam Okafor', 'Sheridan College', 'Animation, 4th year', 'VFX Artist', 'Colourist', 'Content Creator'],
  ['Riley Chen', 'Vincent Massey Secondary', 'Grade 12', 'Production Assistant', 'Actor', 'Stills Photographer'],
  ['Morgan Ouellette', 'University of Windsor', 'Drama, 2nd year', 'Actor', 'Background Performer', 'Publicist'],
  ['Casey Haddad', 'Toronto Metropolitan University', 'Image Arts, 3rd year', 'Gaffer', 'Key Grip', '1st Assistant Camera'],
  ['Taylor Nguyen', 'Humber College', 'Film & TV, 1st year', 'Assistant Director', 'Script Supervisor', 'Production Coordinator'],
  ['Jamie Dubois', 'University of Windsor', 'Visual Arts, 4th year', 'Production Designer', 'Set Decorator', 'Props Master'],
  ['Alex Romano', 'Holy Names Catholic High School', 'Grade 11', 'BTS Videographer', 'Content Creator', 'Production Assistant'],
  ['Quinn Mahmoud', 'York University', 'Cinema & Media Arts, 2nd year', 'Editor', 'Assistant Editor', 'Composer'],
  ['Drew Kowalski', 'St. Clair College', 'Fashion, 2nd year', 'Costume Designer', 'Wardrobe Stylist', 'Makeup Artist'],
  ['Skyler Bennett', 'Western University', 'Media, 3rd year', 'Location Scout', 'Production Accountant', 'Grip']
];
const statuses = ['new', 'new', 'new', 'reviewing', 'reviewing', 'interview', 'approve', 'hired', 'decline', 'new', 'reviewing', 'interview'];
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

export async function addDemoApplications({store, files}) {
  const now = Date.now();
  await store.addStaff({email: 'jack@buzzflix.ca', name: 'Jack', role: 'admin'}, now);
  await addExampleTeam(store, now);
  const team = ['example.megan@buzzflix.ca', 'example.owen@buzzflix.ca', 'jack@buzzflix.ca', 'example.priya@buzzflix.ca'];
  for (const [index, [name, school, program_year, role_1, role_2, role_3]] of people.entries()) {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const submitted = now - (index + 1) * 26 * 60 * 60_000;
    const row = {id, year: '2027', submitted_at: submitted, updated_at: submitted, name, email: `${name.split(' ')[0].toLowerCase()}@example.com`,
      school, program_year, role_1, role_2, role_3, additional_roles: '', consent_version: '2027-text-v2', status: statuses[index],
      assigned_to: statuses[index] === 'new' ? null : team[index % team.length],
      experience: `I've worked on ${index % 3 + 2} short films at school, mostly as ${role_1.toLowerCase()}, and I shoot my own projects on weekends.`,
      why_join: 'I want to learn on a real feature set from people who do this for a living, and Buzzflix is the only place a student can do that in Windsor.'};
    if (index % 2 === 0) {
      row.resume_key = `2027/${id}/resume.pdf`;
      await files.put(row.resume_key, pdf);
    }
    await store.insertApplication(row);
    await store.addActivity(id, row.email, 'submitted', '', submitted);
  }
  await store.addNote('00000000-0000-4000-8000-000000000006', 'example.megan@buzzflix.ca', 'Strong lighting reel. Worth an interview for gaffer.', now - 3_600_000);
  await store.addNote('00000000-0000-4000-8000-000000000007', 'example.owen@buzzflix.ca', 'Interviewed on Zoom. Organised, knows set etiquette, has run a call sheet before. Recommend AD.', now - 1_800_000, 'interview');
  await store.addScorecard('00000000-0000-4000-8000-000000000007', 'jack@buzzflix.ca',
    JSON.stringify({skills: 4, communication: 5, attitude: 5, teamwork: 4, reliability: 4}),
    'Organised, knows set etiquette, has run a call sheet before. Best fit as Assistant Director.', 'approve', now - 1_700_000);
  await store.addScorecard('00000000-0000-4000-8000-000000000009', 'example.megan@buzzflix.ca',
    JSON.stringify({skills: 2, communication: 3, attitude: 4, teamwork: 3, reliability: 2}),
    'Keen, but can only work two weekends over the summer. Worth encouraging to apply again next year.', 'decline', now - 1_600_000);
}

// Example teammates to assign applications to while the real team hasn't signed in yet. The same three are in
// the Cloudflare database; remove them there with: DELETE FROM staff WHERE email LIKE 'example.%';
export const EXAMPLE_TEAM = [['example.megan@buzzflix.ca', 'Megan Tran (example)'], ['example.owen@buzzflix.ca', 'Owen Laurent (example)'],
  ['example.priya@buzzflix.ca', 'Priya Shah (example)']];
export async function addExampleTeam(store, now = Date.now()) {
  for (const [email, name] of EXAMPLE_TEAM) await store.addStaff({email, name}, now);
}

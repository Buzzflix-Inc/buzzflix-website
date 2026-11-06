/**
 * The interview scorecard and the emails staff send applicants, used by worker/staff.js and shown on
 * /staff/application. Edit the wording here; the staff pages pick it up from GET /api/staff/me.
 */

// Each is rated 1 (poor) to 5 (excellent) in the scorecard filled in when an interview is complete.
export const SCORECARD = [
  {key: 'skills', label: 'Skills and experience for the positions'},
  {key: 'communication', label: 'Communication'},
  {key: 'attitude', label: 'Enthusiasm and attitude'},
  {key: 'teamwork', label: 'Teamwork'},
  {key: 'reliability', label: 'Reliability and availability'}
];

// Emails to applicants. {first_name}, {positions} and {sender} are filled in on the page, where the text can be
// edited before sending. `when` is the status an application must be at, and `admin` limits it to admins.
export const EMAIL_TEMPLATES = {
  invite: {
    label: 'Invite to interview',
    when: ['reviewing', 'interview'],
    subject: 'Your Buzzflix 2027 interview',
    body: `Hi {first_name},

Thanks for applying to Buzzflix 2027. We enjoyed reading your application and would like to invite you to an interview about {positions}.

The interview is a relaxed 20-minute video call. Please reply with a few times that work for you over the next week, and we’ll send you a link.

{sender}
Buzzflix`
  },
  offer: {
    label: 'Offer',
    when: ['hired'],
    admin: true,
    subject: 'Welcome to the Buzzflix 2027 crew',
    body: `Hi {first_name},

Congratulations! We’re delighted to offer you a place on the Buzzflix 2027 crew.

Please reply to this email within a week to accept, and we’ll send you everything you need to know before the season starts.

{sender}
Buzzflix`
  },
  not_this_time: {
    label: 'Not this time',
    when: ['not_hired'],
    admin: true,
    subject: 'Your Buzzflix 2027 application',
    body: `Hi {first_name},

Thank you for applying to Buzzflix 2027 and for the time you gave us. We had many strong applicants this year, and we’re not able to offer you a place this time.

We’d love to hear from you again next season, and we wish you the best with your projects.

{sender}
Buzzflix`
  }
};

// Template keys this person can send for an application at `status`.
export const allowedTemplates = (status, isAdmin) =>
  Object.keys(EMAIL_TEMPLATES).filter(key => EMAIL_TEMPLATES[key].when.includes(status) && (isAdmin || !EMAIL_TEMPLATES[key].admin));

// How many people each department hires, for the "Crew by department" breakdown on the Hired step. Starts at one
// per position on the apply page (worker/apply.js DEPARTMENTS); change a number to set that department's target.
export const CREW_TARGETS = {
  'Production': 6,
  'Camera': 5,
  'Grip & Electric': 5,
  'Sound': 3,
  'Art & Wardrobe': 7,
  'Post-Production': 6,
  'Social Media': 4,
  'Acting': 2
};

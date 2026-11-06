// The welcome tour: shown once, the first time someone opens a staff page (loadMe in staff-common.js starts it
// while their profile says onboarded: false), and again from "Show the tour" on the profile page. Six short steps,
// one of them setting up their profile (name, role, department). Finishing or skipping marks them as onboarded.
import {api, h, avatar, statusPill, showMe} from './staff-common.js';

let dialog;

export function startTour(info, {firstTime = false, onProfile} = {}) {
  if (dialog?.open) return;
  const {me} = info;
  const isAdmin = me.role === 'admin';
  const label = status => info.statusLabels[status] || status;
  const profile = {name: me.name, title: me.title || '', department: me.department || ''};

  // The profile step's form, with a card that previews how teammates will see them.
  const nameInput = h('input', {id: 'tour-name', name: 'name', maxlength: '80', required: true, autocomplete: 'name', value: profile.name});
  const titleInput = h('input', {id: 'tour-title', name: 'title', maxlength: '80', autocomplete: 'organization-title',
    placeholder: 'For example: Camera lead, Producer', value: profile.title});
  const departmentSelect = h('select', {id: 'tour-department', name: 'department'},
    h('option', {value: ''}, 'Choose…'), ...info.staffDepartments.map(name => h('option', {value: name, selected: name === profile.department}, name)));
  const preview = h('div', {class: 'staff-tour-person'});
  const drawPreview = () => {
    const name = nameInput.value.trim() || me.name;
    const detail = [titleInput.value.trim(), departmentSelect.value].filter(Boolean).join(' · ');
    preview.replaceChildren(avatar(name, me.email, me.colour), h('span', {}, h('strong', {}, name), h('small', {}, detail || me.email)));
  };
  for (const field of [nameInput, titleInput, departmentSelect]) field.addEventListener('input', drawPreview);
  drawPreview();
  const profileError = h('p', {class: 'staff-message is-error', role: 'alert'});

  const flow = ['new', 'reviewing', 'interview', 'approve', 'hired'];
  const steps = [
    {
      title: firstTime ? `Welcome, ${me.name.split(' ')[0]}` : 'The staff area in a minute',
      art: () => h('div', {class: 'staff-tour-hello'}, avatar(me.name, me.email, me.colour)),
      body: () => [
        h('p', {}, 'This is where the Buzzflix team reviews applications together, from the moment they arrive to the final hiring call.'),
        h('p', {}, firstTime ? 'Let’s set up your profile, then take a quick look around. It takes about a minute.' : 'Here’s a quick look around.')]
    },
    {
      title: 'Your profile',
      profile: true,
      art: () => preview,
      body: () => [
        h('p', {}, 'This is how teammates see you when they assign work or see who’s viewing an application.'),
        h('div', {class: 'staff-field'}, h('label', {for: 'tour-name'}, 'Your name'), nameInput),
        h('div', {class: 'staff-tour-fields'},
          h('div', {class: 'staff-field'}, h('label', {for: 'tour-title'}, 'Your role (optional)'), titleInput),
          h('div', {class: 'staff-field'}, h('label', {for: 'tour-department'}, 'Department (optional)'), departmentSelect)),
        profileError]
    },
    {
      title: 'Find your applications',
      art: () => h('div', {class: 'staff-tour-views'},
        h('span', {class: 'is-on'}, 'Assigned to me', h('b', {}, '3')),
        isAdmin && h('span', {class: 'is-decision'}, 'Needs your decision', h('b', {}, '2')),
        h('span', {}, 'All applications', h('b', {}, '12'))),
      body: () => [
        h('p', {}, h('strong', {}, 'Assigned to me'), ' opens first: the applications that are yours to review and interview.',
          isAdmin ? ' As an admin, ' : '', isAdmin && h('strong', {}, 'Needs your decision'), isAdmin ? ' holds every recommendation waiting for your final call.' : ''),
        h('p', {}, h('strong', {}, 'All applications'), ' shows the whole year, with a bar of how many are at each step. Use ',
          h('strong', {}, 'By step'), ', search and the filters to narrow it down. Click any row to read the full application.')]
    },
    {
      title: 'Share out the work',
      art: () => h('div', {class: 'staff-tour-assign'},
        h('div', {}, avatar(me.name, me.email, me.colour), h('span', {}, `${me.name} (me)`), h('small', {}, '1 open')),
        h('div', {}, h('span', {class: 'staff-avatar staff-tour-ghost', 'aria-hidden': 'true'}, 'MT'), h('span', {}, 'A teammate'),
          h('small', {}, '0 open', h('em', {}, 'Least busy')))),
      body: () => [
        h('p', {}, 'Click ', h('strong', {}, 'Assigned to'), ' on any application to pick someone. You’re at the top, and each person shows how many open applications they have, so it’s easy to keep things even.'),
        h('p', {}, 'Assigning a new application moves it to In review straight away. Changed your mind? Press ', h('strong', {}, 'Undo'), '. Tick several rows to assign them all at once.')]
    },
    {
      title: 'From application to hire',
      art: () => h('ol', {class: 'staff-tour-flow'}, flow.map(status => h('li', {}, statusPill(status, info.statusLabels)))),
      body: () => [
        h('p', {}, `Move an application to ${label('interview')} once you’ve set one up. After the interview, press `, h('strong', {}, 'Interview complete'),
          ' to fill in a short scorecard and recommend hiring or not.'),
        h('p', {}, isAdmin
          ? 'Recommendations land in Needs your decision, where you choose Hired or Not hired. The Hired step shows how full each department is.'
          : 'An admin makes the final Hired or Not hired call. Leave notes on any application to keep everyone in the loop.')]
    },
    {
      title: 'Work together, live',
      art: () => h('div', {class: 'staff-tour-live'},
        h('span', {class: 'staff-viewer', 'aria-hidden': 'true'}, 'PS'), h('span', {class: 'staff-viewer', 'aria-hidden': 'true'}, 'OL'),
        h('span', {}, 'are also viewing this')),
      body: () => [
        h('p', {}, 'Everyone’s changes show up on your screen within a few seconds, with no need to refresh. Initials next to an application mean a teammate has it open right now.'),
        h('p', {}, 'Click your name at the top of any page for your profile and settings, where you can also see this tour again.')]
    }
  ];

  let index = 0;
  const art = h('div', {class: 'staff-tour-art', 'aria-hidden': 'true'});
  const heading = h('h2', {id: 'tour-title-heading'});
  const counter = h('p', {class: 'staff-tour-count'});
  const dots = h('ol', {class: 'staff-tour-dots', 'aria-hidden': 'true'}, steps.map(() => h('li')));
  const body = h('div', {class: 'staff-tour-body'});
  const back = h('button', {type: 'button', class: 'staff-button-quiet'}, 'Back');
  const next = h('button', {type: 'submit', class: 'button'});
  const skip = h('button', {type: 'button', class: 'staff-link-button staff-tour-skip'}, 'Skip the tour');
  const form = h('form', {method: 'dialog', class: 'staff-tour-form', novalidate: true},
    art, h('div', {class: 'staff-tour-text'}, counter, heading, body),
    h('div', {class: 'staff-tour-actions'}, skip, h('span', {class: 'staff-tour-spacer'}), dots, back, next));
  dialog?.remove();
  dialog = h('dialog', {class: 'staff-dialog staff-tour', 'aria-labelledby': 'tour-title-heading'}, form);
  document.body.append(dialog);

  function show(to) {
    index = to;
    const step = steps[index];
    counter.textContent = `Step ${index + 1} of ${steps.length}`;
    heading.textContent = step.title;
    art.replaceChildren(step.art());
    art.setAttribute('aria-hidden', String(!step.profile)); // the profile preview is worth hearing; the others are pictures
    body.replaceChildren(...step.body());
    [...dots.children].forEach((dot, i) => dot.classList.toggle('is-on', i <= index));
    back.hidden = index === 0;
    next.textContent = index === 0 ? (firstTime ? 'Set up my profile' : 'Start') : index === steps.length - 1 ? 'Get started' : 'Next';
    skip.hidden = index === steps.length - 1;
    profileError.textContent = '';
    (step.profile ? nameInput : next).focus();
  }

  // Saving the profile on its step's Next; a problem keeps them on the step with the message.
  async function saveProfile() {
    const fields = {name: nameInput.value.trim(), title: titleInput.value.trim(), department: departmentSelect.value};
    if (!fields.name) { profileError.textContent = 'Enter your name.'; nameInput.focus(); return false; }
    if (fields.name === profile.name && fields.title === profile.title && fields.department === profile.department) return true;
    next.disabled = true;
    try {
      const {person} = await api(`/team/${encodeURIComponent(me.email)}`, {method: 'PATCH', body: fields});
      Object.assign(profile, fields);
      Object.assign(me, {name: person.name, title: person.title, department: person.department});
      showMe(me);
      onProfile?.(person);
      return true;
    } catch (failure) {
      profileError.textContent = failure.message;
      return false;
    } finally {
      next.disabled = false;
    }
  }

  // Finished or skipped: don't show it again. If that fails it simply shows next time.
  const done = () => {
    me.onboarded = true;
    api(`/team/${encodeURIComponent(me.email)}`, {method: 'PATCH', body: {onboarded: true}}).catch(() => {});
    dialog.close();
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (steps[index].profile && !await saveProfile()) return;
    if (index === steps.length - 1) done();
    else show(index + 1);
  });
  back.addEventListener('click', () => show(index - 1));
  skip.addEventListener('click', done);
  dialog.addEventListener('cancel', event => { event.preventDefault(); done(); }); // Escape skips too
  dialog.addEventListener('close', () => dialog.remove());

  dialog.showModal();
  show(0);
}

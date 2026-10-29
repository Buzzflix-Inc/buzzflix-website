/** Apply page: pick three positions by department, then carry them into the application form. */
const picker = document.querySelector('.picker');
const form = document.querySelector('[data-application-form]');
if (picker && form) {
  const depts = [...picker.querySelectorAll('.dept')];
  const picks = [];
  const status = picker.querySelector('[data-picker-status]');
  const slots = [...picker.querySelectorAll('[data-picker-slots] li')];
  const slotLabels = slots.map(slot => slot.textContent);
  const next = picker.querySelector('[data-picker-continue]');
  const hint = picker.querySelector('[data-picker-hint]');
  const slotList = picker.querySelector('[data-picker-slots]');
  const fields = [form.elements.role_1, form.elements.role_2, form.elements.role_3];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const panelOf = dept => document.getElementById(dept.getAttribute('aria-controls'));
  const deptOf = button => button.closest('.dept-panel').previousElementSibling.dataset.dept;

  // One department open at a time; the open panel spans the row under its tile.
  const toggle = dept => {
    const open = dept.getAttribute('aria-expanded') !== 'true';
    depts.forEach(other => {
      other.setAttribute('aria-expanded', String(other === dept && open));
      panelOf(other).hidden = !(other === dept && open);
    });
  };

  const goToForm = () => {
    form.closest('section').scrollIntoView({ behavior:reduced.matches ? 'instant' : 'smooth' });
    form.elements.name.focus({ preventScroll:true });
  };

  const render = () => {
    const full = picks.length === 3;
    picker.querySelectorAll('.pick').forEach(button => {
      const picked = picks.some(p => p.role === button.textContent);
      button.setAttribute('aria-pressed', String(picked));
      button.disabled = full && !picked;
    });
    depts.forEach(dept => {
      const count = picks.filter(p => p.dept === dept.dataset.dept).length;
      dept.querySelector('.dept-count').textContent = count || '';
      dept.classList.toggle('has-picks', count > 0);
    });
    slots.forEach((slot, i) => {
      const pick = picks[i];
      slot.classList.toggle('is-filled', !!pick);
      slot.replaceChildren();
      if (!pick) {
        slot.textContent = slotLabels[i];
        slot.removeAttribute('tabindex');
        slot.removeAttribute('aria-label');
        return;
      }
      slot.tabIndex = 0;
      slot.setAttribute('aria-label', `${pick.role}, ${pick.dept}. Choice ${i + 1} of 3. Drag or use the arrow keys to reorder.`);
      const role = document.createElement('span');
      role.textContent = pick.role;
      const dept = document.createElement('small');
      dept.textContent = pick.dept;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.remove = pick.role;
      remove.setAttribute('aria-label', `Remove ${pick.role}`);
      remove.textContent = '×';
      slot.append(role, dept, remove);
    });
    status.textContent = `${picks.length} of 3 picked${full ? '!' : ''}`;
    hint.hidden = picks.length < 2;
    next.hidden = !full;
    fields.forEach((field, i) => { field.value = picks[i]?.role || ''; });
    form.dispatchEvent(new Event('input'));
  };

  picker.addEventListener('click', event => {
    const dept = event.target.closest('.dept');
    if (dept) { toggle(dept); return; }
    const pick = event.target.closest('.pick');
    if (pick) {
      const at = picks.findIndex(p => p.role === pick.textContent);
      if (at >= 0) picks.splice(at, 1);
      else if (picks.length < 3) picks.push({ role:pick.textContent, dept:deptOf(pick) });
      render();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      picks.splice(picks.findIndex(p => p.role === remove.dataset.remove), 1);
      render();
      return;
    }
    if (event.target.closest('[data-picker-continue]')) { event.preventDefault(); goToForm(); }
  });

  // Reorder picks: drag a filled slot onto another, or use the arrow keys on a focused slot.
  const move = (from, to) => {
    if (to < 0 || to >= picks.length || to === from) return false;
    picks.splice(to, 0, picks.splice(from, 1)[0]);
    render();
    return true;
  };
  let drag = null;
  const endDrag = () => {
    slots.forEach(slot => { slot.classList.remove('is-dragging', 'is-target'); slot.style.transform = ''; });
    const { from, to } = drag;
    drag = null;
    move(from, to);
  };
  slotList.addEventListener('pointerdown', event => {
    const slot = event.target.closest('.picker-slot.is-filled');
    if (!slot || event.button !== 0 || event.target.closest('button') || picks.length < 2) return;
    const from = slots.indexOf(slot);
    drag = { id:event.pointerId, from, to:from, x:event.clientX, y:event.clientY };
    slot.setPointerCapture(event.pointerId);
    slot.classList.add('is-dragging');
  });
  slotList.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    slots[drag.from].style.transform = `translate(${event.clientX - drag.x}px,${event.clientY - drag.y}px)`;
    drag.to = drag.from;
    slots.forEach((slot, i) => {
      const r = slot.getBoundingClientRect();
      const over = i !== drag.from && i < picks.length && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      slot.classList.toggle('is-target', over);
      if (over) drag.to = i;
    });
  });
  slotList.addEventListener('pointerup', event => { if (drag && event.pointerId === drag.id) endDrag(); });
  slotList.addEventListener('pointercancel', event => { if (drag && event.pointerId === drag.id) { drag.to = drag.from; endDrag(); } });
  slotList.addEventListener('keydown', event => {
    const slot = event.target.closest('.picker-slot.is-filled');
    const step = { ArrowLeft:-1, ArrowUp:-1, ArrowRight:1, ArrowDown:1 }[event.key];
    if (!slot || event.target !== slot || !step) return;
    event.preventDefault();
    const from = slots.indexOf(slot);
    if (move(from, from + step)) slots[from + step].focus();
  });

  // The position fields are read-only, so the browser won't require them; stop the form here
  // (capture runs before application-form.js) and send the applicant back to the picker.
  document.addEventListener('submit', event => {
    if (event.target !== form || picks.length === 3) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const error = form.querySelector('.application-error');
    error.textContent = `Pick three positions above before you submit. You have ${picks.length} so far.`;
    error.hidden = false;
    picker.scrollIntoView({ behavior:reduced.matches ? 'instant' : 'smooth' });
  }, true);
}

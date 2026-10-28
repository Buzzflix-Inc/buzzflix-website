/** Accessible mobile navigation; desktop navigation remains visible without JS. */
function initNavigation(){
 const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#main-nav');
 if(!toggle||!nav)return;
 const close=()=>{toggle.setAttribute('aria-expanded','false');nav.dataset.collapsed='true'};
 close();
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));nav.dataset.collapsed=String(!open)});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){close();toggle.focus()}});
 nav.addEventListener('click',e=>{if(e.target.closest('a'))close()});
 matchMedia('(min-width:801px)').addEventListener('change',close);
}

/** Mouse dragging enhances native touch scrolling and keyboard access. */
function initCarousels() {
  document.querySelectorAll('[data-carousel]').forEach(root => {
    const track = root.querySelector('.carousel-track');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let gesture = null;
    let suppressClick = false;

    // Arrow keys move by the actual spacing between cards.
    const move = direction => {
      const cards = track.querySelectorAll('.card');
      if (!cards.length) return;
      const first = cards[0].getBoundingClientRect();
      const step = cards.length > 1
        ? cards[1].getBoundingClientRect().left - first.left
        : first.width;
      track.scrollBy({ left:direction * step,
        behavior:reduced.matches ? 'instant' : 'smooth' });
    };

    track.addEventListener('dragstart', event => event.preventDefault());
    track.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      suppressClick = false;
      gesture = { id: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
    });
    track.addEventListener('pointermove', event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const delta = event.clientX - gesture.x;
      if (!gesture.moved && Math.abs(delta) < 5) return;
      if (!gesture.moved) {
        gesture.moved = true;
        track.setPointerCapture(event.pointerId);
        track.classList.add('is-dragging');
      }
      event.preventDefault();
      track.scrollLeft = gesture.left - delta;
    });
    const finish = event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      suppressClick = gesture.moved;
      const id = gesture.id;
      gesture = null;
      track.classList.remove('is-dragging');
      if (track.hasPointerCapture(id)) track.releasePointerCapture(id);
    };
    track.addEventListener('pointerup', finish);
    track.addEventListener('pointercancel', finish);
    track.addEventListener('lostpointercapture', finish);
    track.addEventListener('pointerleave', () => {
      if (gesture && !gesture.moved) gesture = null;
    });
    track.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    }, true);
    track.addEventListener('keydown', event => {
      suppressClick = false;
      if (event.target !== track || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    });
  });
}

const ICONS = {
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  muted: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  expand: '<path d="M5 9.5V5h4.5M19 9.5V5h-4.5M5 14.5V19h4.5M19 14.5V19h-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

/**
 * Click-to-play YouTube with our own controls. The poster links to YouTube until clicked, so nothing loads
 * from Google before then. YouTube's controls are off (they linger for seconds after the cursor leaves);
 * the player is driven over postMessage and our controls fade as soon as the cursor goes.
 */
function initVideos() {
  const ORIGIN = 'https://www.youtube-nocookie.com';
  document.querySelectorAll('[data-video]').forEach(root => {
    const poster = root.querySelector('.video-poster');
    poster.addEventListener('click', event => {
      event.preventDefault();
      const title = poster.textContent.trim();
      const frame = document.createElement('iframe');
      frame.src = `${ORIGIN}/embed/${root.dataset.video}?autoplay=1&controls=0&rel=0&playsinline=1&disablekb=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
      frame.title = title;
      frame.tabIndex = -1;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';

      const surface = document.createElement('button');
      surface.type = 'button';
      surface.className = 'video-surface';
      const bar = document.createElement('div');
      bar.className = 'video-bar';
      const make = cls => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `video-button ${cls}`;
        return b;
      };
      const toggle = make('video-toggle'), mute = make('video-mute'), full = make('video-full');
      full.innerHTML = icon('expand');
      full.setAttribute('aria-label', 'Full screen');
      bar.append(toggle, mute);
      if (document.fullscreenEnabled) bar.append(full);
      root.replaceChildren(frame, surface, bar);
      root.classList.add('is-playing');

      const send = (func, args = []) =>
        frame.contentWindow?.postMessage(JSON.stringify({event: 'command', func, args}), ORIGIN);
      let playing = true, muted = false, idle;
      const render = () => {
        root.classList.toggle('is-paused', !playing);
        toggle.innerHTML = icon(playing ? 'pause' : 'play');
        toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        surface.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${title}`);
        mute.innerHTML = icon(muted ? 'muted' : 'sound');
        mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      };
      const playPause = () => { send(playing ? 'pauseVideo' : 'playVideo'); playing = !playing; render(); };
      // On touch screens the first tap only brings the controls up; a tap while they show pauses.
      let tapShowsControls = false;
      surface.addEventListener('pointerdown', e => {
        tapShowsControls = e.pointerType === 'touch' && playing && !root.classList.contains('show-controls');
      });
      surface.addEventListener('click', () => (tapShowsControls ? wake() : playPause()));
      toggle.addEventListener('click', playPause);
      mute.addEventListener('click', () => { send(muted ? 'unMute' : 'mute'); muted = !muted; render(); });
      full.addEventListener('click', () =>
        document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen());

      // Controls show while the cursor moves over the video, and hide 1.5s after it stops or at once when it leaves.
      const wake = () => {
        root.classList.add('show-controls');
        clearTimeout(idle);
        idle = setTimeout(() => root.classList.remove('show-controls'), 1500);
      };
      root.addEventListener('pointermove', wake);
      root.addEventListener('pointerleave', () => { clearTimeout(idle); root.classList.remove('show-controls'); });
      root.addEventListener('focusin', wake);

      // Follow YouTube's own state (pausing at the end, autoplay blocked, etc.).
      frame.addEventListener('load', () =>
        frame.contentWindow.postMessage(JSON.stringify({event: 'listening', id: 1, channel: 'widget'}), ORIGIN));
      window.addEventListener('message', e => {
        if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
        let data;
        try { data = JSON.parse(e.data); } catch { return; }
        const state = data.event === 'onStateChange' ? data.info : data.info?.playerState;
        if (state === 1 || state === 3) playing = true;
        else if (state === 0 || state === 2) playing = false;
        if (typeof data.info?.muted === 'boolean') muted = data.info.muted;
        render();
      });

      render();
      toggle.focus({preventScroll: true});
      wake();
    });
  });
}

initNavigation();
initCarousels();
initVideos();

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

/** Announcement bar: the X removes it, and it stays closed on later visits until its key changes. */
function initAnnouncement(){
 const bar=document.querySelector('[data-announcement]');
 if(!bar)return;
 const key=`announcement-closed:${bar.dataset.announcement}`;
 try{if(localStorage.getItem(key))return bar.remove()}catch{}
 bar.querySelector('.announcement-close')?.addEventListener('click',()=>{
  bar.remove();
  try{localStorage.setItem(key,'1')}catch{}
 });
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
      const cards = track.children;
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
      // One video at a time: pause any other player on the page.
      document.querySelectorAll('.video.is-playing iframe').forEach(other =>
        other.contentWindow?.postMessage(JSON.stringify({event: 'command', func: 'pauseVideo', args: []}), ORIGIN));
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

/**
 * The 404 slate claps shut and opens again on each click, and the take number goes up as the sticks meet.
 * Take 04, 08, 12… opens the Buzz Run minigame (bee-game.js).
 * The clap runs over the CSS one (ending it if it is still playing), so the sticks settle at the same angle
 * and nothing restarts. With reduced motion the take still counts, without the clap.
 */
function initSlate() {
  const slate = document.querySelector('.slate');
  if (!slate) return;
  const sticks = slate.querySelector('.slate-sticks');
  const take = slate.querySelector('[data-take]').lastChild;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  slate.dataset.clap = '';
  let count = parseInt(take.nodeValue, 10), clap, shut, game;
  slate.addEventListener('click', () => {
    count++;
    const show = () => { take.nodeValue = String(count).padStart(2, '0'); };
    clearTimeout(shut);
    // Take 04 (and every fourth take after) opens the Buzz Run minigame once the sticks settle.
    if (count % 4 === 0) {
      clearTimeout(game);
      game = setTimeout(() => import('./bee-game.js').then(m => m.openGame()), reduced.matches ? 0 : 650);
    }
    if (reduced.matches) return show();
    // A click mid-clap starts from wherever the sticks are now.
    const from = getComputedStyle(sticks).transform;
    clap?.cancel();
    sticks.getAnimations().forEach(a => a.animationName === 'clap' && a.finish());
    clap = sticks.animate([
      { transform: from, easing: 'cubic-bezier(.55,0,1,.45)' },
      { transform: 'rotate(0)', offset: .3, easing: 'cubic-bezier(.25,.6,.3,1)' },
      { transform: 'rotate(-7deg)' }
    ], { duration: 650 });
    shut = setTimeout(show, 195);
  });
}

/** Bee cursor (mouse and trackpad only): a bee drawn on the page follows the mouse, so it can ease into its tilt
 *  over links and buttons (a CSS cursor can only swap images). With it on, the CSS cursor tokens become blank
 *  images whose hotspot says the state: 0 0 resting bee, 1 1 clickable; any other cursor (text, grab) hides the
 *  bee for the native one. A switch added to the footer turns it off for a regular cursor, remembered per browser. */
function initBeeCursor(){
 if(!matchMedia('(hover:hover) and (pointer:fine)').matches)return;
 const root=document.documentElement,KEY='cursor';
 let on=true;
 try{on=localStorage.getItem(KEY)!=='regular'}catch{}
 const bee=document.createElement('div');
 bee.className='bee-cursor';
 bee.dataset.state='hidden';
 document.body.append(bee);
 let x=0,y=0,target=null,frame=0;
 const place=()=>{frame=0;bee.style.translate=`${x}px ${y}px`};
 const update=()=>{
  if(!on||!target?.isConnected||target.tagName==='IFRAME'){bee.dataset.state='hidden';return}
  const c=getComputedStyle(target).cursor;
  bee.dataset.state=/\) 1 1, none$/.test(c)?'hover':/\) 0 0, none$/.test(c)?'idle':'hidden';
  const host=target.closest('dialog[open]')||document.body; // a modal dialog sits above everything else
  if(bee.parentNode!==host)host.append(bee);
 };
 document.addEventListener('pointermove',e=>{
  if(e.pointerType!=='mouse'){target=null;update();return}
  x=e.clientX;y=e.clientY;
  if(!frame)frame=requestAnimationFrame(place);
  if(e.target!==target||bee.dataset.state==='hidden'){target=e.target;update()}
 },{passive:true});
 document.addEventListener('pointerout',e=>{if(!e.relatedTarget){target=null;update()}});
 document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')bee.classList.add('is-pressed')});
 addEventListener('pointerup',()=>bee.classList.remove('is-pressed'));
 setInterval(update,250); // states that change under a still mouse: video controls hiding, buttons disabling
 // A new page doesn't know where the mouse is until it moves, so each page hands its position to the next.
 addEventListener('pagehide',()=>{try{target?sessionStorage.setItem(KEY+'-at',`${x},${y}`):sessionStorage.removeItem(KEY+'-at')}catch{}});
 try{
  const [sx,sy]=(sessionStorage.getItem(KEY+'-at')||'').split(',').map(Number);
  if(sx>=0&&sy>=0&&sx<=innerWidth&&sy<=innerHeight){x=sx;y=sy;place();target=document.elementFromPoint(x,y)}
 }catch{}

 const toggle=document.createElement('button');
 toggle.type='button';
 toggle.className='cursor-switch';
 toggle.setAttribute('role','switch');
 toggle.innerHTML='<span class="cursor-switch-track" aria-hidden="true"></span>Bee cursor';
 const apply=()=>{
  root.classList.toggle('bee-cursor-on',on);
  root.classList.toggle('regular-cursor',!on);
  toggle.setAttribute('aria-checked',String(on));
  update();
 };
 // Turning it off pops the bee into a little cloud where it was, rather than it simply vanishing.
 const poof=()=>{
  if(bee.dataset.state==='hidden'||matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const cloud=document.createElement('div');
  cloud.className='bee-poof';
  cloud.setAttribute('aria-hidden','true');
  cloud.style.translate=`${x}px ${y}px`;
  cloud.innerHTML='<i></i>'.repeat(8);
  cloud.querySelectorAll('i').forEach((p,i)=>{if(i)p.style.setProperty('--a',`${i*360/7+20}deg`)});
  bee.classList.add('is-popping');
  bee.parentNode.append(cloud);
  setTimeout(()=>cloud.remove(),700);
 };
 toggle.addEventListener('click',()=>{
  on=!on;
  if(on)bee.classList.remove('is-popping');else poof();
  try{on?localStorage.removeItem(KEY):localStorage.setItem(KEY,'regular')}catch{}
  apply();
 });
 (document.querySelector('.footer-legal')||document.querySelector('.site-footer'))?.append(toggle);
 apply();
}

/** Click the header logo four times in quick succession and a swarm of bees bursts out of it and buzzes off
 *  the screen. On the homepage the logo scrolls to the top instead of reloading, so the clicks can add up;
 *  elsewhere the first click goes home and the count carries over. Skipped for people who prefer reduced motion. */
function initLogoSwarm(){
 const logo=document.querySelector('.site-header .brand');
 if(!logo)return;
 const KEY='logo-clicks',CLICKS=4,GAP=1500,reduced=matchMedia('(prefers-reduced-motion:reduce)');
 const home=new URL(logo.href,location.href).pathname.replace(/(index)?(\.html)?$/,'');
 const onHome=()=>location.pathname.replace(/(index)?(\.html)?$/,'')===home;
 let swarming=false;
 const swarm=()=>{
  if(swarming||reduced.matches)return;
  swarming=true;
  const r=logo.getBoundingClientRect(),ox=r.left+r.width*.12,oy=r.top+r.height*.5;
  const box=document.createElement('div');
  box.className='bee-swarm';
  box.setAttribute('aria-hidden','true');
  const W=innerWidth,H=innerHeight,rand=(a,b)=>a+Math.random()*(b-a);
  const flights=[];
  for(let i=0;i<18;i++){
   // The outer box flies the path, the middle one turns the bee to face where it's heading, the image flaps.
   const bee=document.createElement('div'),face=document.createElement('span'),img=document.createElement('img');
   img.src=new URL('../images/bee-32d3992.png',import.meta.url).href;
   img.alt='';img.width=160;img.height=129;
   img.style.animationDelay=`${-rand(0,.2)}s`;
   face.append(img);bee.append(face);box.append(bee);
   const size=rand(26,46);bee.style.width=`${size}px`;
   // Two wandering stops on screen, then out past a random edge.
   const pts=[[ox,oy],[rand(.1,.9)*W,rand(.1,.8)*H],[rand(.05,.95)*W,rand(.1,.9)*H]];
   const side=Math.floor(rand(0,4)),m=80;
   pts.push(side===0?[-m,rand(0,H)]:side===1?[W+m,rand(0,H)]:side===2?[rand(0,W),H+m]:[rand(0,W),-m]);
   const last=pts.length-1,timing={duration:rand(2200,3400),delay:i*45,fill:'both'};
   flights.push(bee.animate(pts.map(([x,y],k)=>({
    transform:`translate(${x-size/2}px,${y-size*.4}px) scale(${k?1:.2})`,opacity:k?1:0,offset:k/last,easing:'ease-in-out'
   })),timing).finished);
   const turns=[];
   for(let k=0;k<last;k++){
    const f=pts[k+1][0]<pts[k][0]?-1:1,o=k/last;
    turns.push({transform:`scaleX(${f})`,offset:k?Math.min(o+.04,1):0},{transform:`scaleX(${f})`,offset:(k+1)/last-(k+1<last?.04:0)});
   }
   face.animate(turns,timing);
  }
  document.body.append(box);
  Promise.all(flights).finally(()=>{box.remove();swarming=false});
 };
 logo.addEventListener('click',e=>{
  if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  let n=1;
  try{
   const [c,t]=(sessionStorage.getItem(KEY)||'').split(',').map(Number);
   if(Date.now()-t<GAP)n=c+1;
  }catch{}
  if(n>=CLICKS){swarm();n=0}
  try{sessionStorage.setItem(KEY,`${n},${Date.now()}`)}catch{}
  if(onHome()){e.preventDefault();scrollTo({top:0,behavior:reduced.matches?'auto':'smooth'})}
 });
}

/** Images can't be dragged out of the page (Firefox ignores -webkit-user-drag). */
document.addEventListener('dragstart',e=>{if(e.target instanceof HTMLImageElement)e.preventDefault()});

/**
 * Homepage photo reel: a second, hidden copy of the photos makes the loop
 * seamless. Only the Pause button stops it (shown on hover or tap); stays a
 * plain scroller for people who prefer reduced motion.
 */
function initReels() {
  const PIXELS_PER_SECOND = 40;
  // The desktop intro fills the screen below the header, so it re-measures
  // when the header can change height: on resize and when the announcement closes.
  const intro = document.querySelector('.home-intro');
  if (intro) {
    const fit = () => intro.style.setProperty('--intro-top',
      `${intro.getBoundingClientRect().top + scrollY}px`);
    fit();
    addEventListener('resize', fit);
    // initAnnouncement's click handler runs first and removes the bar.
    document.querySelector('.announcement-close')?.addEventListener('click', fit);
  }
  document.querySelectorAll('[data-reel]').forEach(reel => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const track = reel.querySelector('.reel-track');
    const toggle = reel.querySelector('.reel-toggle');
    [...track.children].forEach(img => {
      const copy = img.cloneNode();
      copy.alt = '';
      copy.loading = 'lazy';
      copy.removeAttribute('fetchpriority');
      copy.setAttribute('aria-hidden', 'true');
      track.append(copy);
    });
    const setSpeed = () => reel.style.setProperty('--reel-duration',
      `${track.scrollWidth / 2 / PIXELS_PER_SECOND}s`);
    setSpeed();
    new ResizeObserver(setSpeed).observe(track);
    reel.scrollLeft = 0;
    reel.dataset.running = '';
    // Moving, the reel can't be scrolled, so it needn't take focus (a tap would focus it).
    reel.removeAttribute('tabindex');
    if (!toggle) return;
    toggle.hidden = false;
    // Touch screens have no hover: a tap on the reel shows the button for a few seconds.
    let hide;
    reel.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      reel.dataset.touched = '';
      clearTimeout(hide);
      hide = setTimeout(() => delete reel.dataset.touched, 3000);
    });
    toggle.addEventListener('click', () => {
      const paused = reel.toggleAttribute('data-paused');
      toggle.firstChild.textContent = paused ? 'Play' : 'Pause';
    });
  });
}

initNavigation();
initAnnouncement();
initCarousels();
initReels();
initVideos();
initSlate();
initBeeCursor();
initLogoSwarm();

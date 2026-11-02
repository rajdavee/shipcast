/*
 * Shipcast Cartoon Kit — original rigged 2D characters, illustrated worlds and
 * magic effects for HyperFrames compositions. Flat vector style, seek-safe:
 * every motion is a GSAP tween on the timeline you pass in, randomness is
 * seeded, nothing reads the clock. MIT, part of Shipcast; no third-party art.
 *
 *   <script src="assets/kit.js"></script>
 *   el.innerHTML = CartoonKit.world('bedroom', { w: 1920, h: 1080, time: 'evening' })
 *                + CartoonKit.character({ id: 'hero', kind: 'kid', x: 700, y: 980, scale: 1 });
 *   CartoonKit.act(tl, '#hero', 'emote', 0.2, { emotion: 'sad' });
 *   CartoonKit.act(tl, '#hero', 'walk', 1.0, { by: 400, dur: 2 });
 *
 * Characters are anchored at their feet (x, y = ground point).
 */
(function () {
  'use strict';

  // ── utils ──────────────────────────────────────────────────────────────
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }
  function shade(hex, amt) {
    var n = parseInt(hex.replace('#', ''), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function q(sel) { return document.querySelector(sel); }
  function has(sel) { return !!document.querySelector(sel); }

  // ── characters ─────────────────────────────────────────────────────────
  var KINDS = {
    kid:    { body: '#f59e0b', accent: '#2563eb', skin: '#f8c9a0', hair: '#2b2118', head: 'round', ears: 'human', limbs: 'human' },
    robot:  { body: '#60a5fa', accent: '#f43f5e', skin: '#e0f2fe', hair: null, head: 'robot', ears: 'antenna', limbs: 'stub' },
    cat:    { body: '#fb923c', accent: '#fde68a', skin: '#fed7aa', hair: null, head: 'round', ears: 'cat', limbs: 'stub', tail: true },
    dog:    { body: '#a16207', accent: '#fef3c7', skin: '#fde68a', hair: null, head: 'round', ears: 'dog', limbs: 'stub', tail: true },
    fox:    { body: '#ea580c', accent: '#ffffff', skin: '#fff7ed', hair: null, head: 'round', ears: 'cat', limbs: 'stub', tail: true },
    dragon: { body: '#34d399', accent: '#fde047', skin: '#bbf7d0', hair: null, head: 'round', ears: 'horns', limbs: 'stub', tail: true, wings: true },
    blob:   { body: '#a78bfa', accent: '#f9a8d4', skin: '#ede9fe', hair: null, head: 'blob', ears: 'none', limbs: 'stub' },
    elder:  { body: '#6b7280', accent: '#b45309', skin: '#e8b48a', hair: '#e5e7eb', head: 'round', ears: 'human', limbs: 'human', beard: true },
    bird:   { body: '#38bdf8', accent: '#facc15', skin: '#e0f2fe', hair: null, head: 'round', ears: 'none', limbs: 'stub', beak: true, wings: true },
  };

  var MOUTHS = {
    closed:  '<path class="m m-closed" d="M-18 6 Q0 12 18 6" fill="none" stroke="#3b1d14" stroke-width="5" stroke-linecap="round"/>',
    smile:   '<path class="m m-smile" d="M-22 2 Q0 26 22 2 Z" fill="#7f1d1d" stroke="#3b1d14" stroke-width="4" stroke-linejoin="round"/>',
    laugh:   '<path class="m m-laugh" d="M-26 0 Q0 38 26 0 Z" fill="#7f1d1d" stroke="#3b1d14" stroke-width="4"/><path class="m m-laugh" d="M-14 16 Q0 26 14 16" fill="#fb7185"/>',
    sad:     '<path class="m m-sad" d="M-18 14 Q0 0 18 14" fill="none" stroke="#3b1d14" stroke-width="5" stroke-linecap="round"/>',
    open:    '<ellipse class="m m-open" cx="0" cy="8" rx="12" ry="14" fill="#7f1d1d" stroke="#3b1d14" stroke-width="4"/>',
    o:       '<ellipse class="m m-o" cx="0" cy="8" rx="9" ry="11" fill="#7f1d1d" stroke="#3b1d14" stroke-width="4"/>',
    flat:    '<path class="m m-flat" d="M-16 8 L16 8" stroke="#3b1d14" stroke-width="5" stroke-linecap="round"/>',
  };

  function headShape(k, c) {
    if (k.head === 'robot') return '<rect x="-78" y="-150" width="156" height="132" rx="34" fill="' + c.body + '" stroke="#1e293b" stroke-width="6"/><rect x="-60" y="-132" width="120" height="96" rx="26" fill="' + c.skin + '"/>';
    if (k.head === 'blob') return '<path d="M-86 -40 C-96 -150 96 -150 86 -40 C80 0 -80 0 -86 -40 Z" fill="' + c.body + '" stroke="#312e81" stroke-width="6"/>';
    var face = k.limbs === 'human' ? c.skin : c.body;
    return '<circle cx="0" cy="-84" r="78" fill="' + face + '" stroke="#3b1d14" stroke-width="6"/>' + (k.limbs === 'human' ? '' : '<ellipse cx="0" cy="-58" rx="48" ry="34" fill="' + c.skin + '"/>');
  }
  function earsShape(k, c) {
    var dark = shade(c.body, -30);
    switch (k.ears) {
      case 'cat': return '<path d="M-62 -128 L-74 -192 L-22 -152 Z" fill="' + c.body + '" stroke="#3b1d14" stroke-width="6" stroke-linejoin="round"/><path d="M62 -128 L74 -192 L22 -152 Z" fill="' + c.body + '" stroke="#3b1d14" stroke-width="6" stroke-linejoin="round"/>';
      case 'dog': return '<ellipse cx="-78" cy="-96" rx="24" ry="50" fill="' + dark + '" stroke="#3b1d14" stroke-width="6" transform="rotate(18 -78 -96)"/><ellipse cx="78" cy="-96" rx="24" ry="50" fill="' + dark + '" stroke="#3b1d14" stroke-width="6" transform="rotate(-18 78 -96)"/>';
      case 'horns': return '<path d="M-40 -150 Q-52 -196 -24 -206 Q-34 -176 -18 -154 Z" fill="' + c.accent + '" stroke="#3b1d14" stroke-width="5"/><path d="M40 -150 Q52 -196 24 -206 Q34 -176 18 -154 Z" fill="' + c.accent + '" stroke="#3b1d14" stroke-width="5"/>';
      case 'antenna': return '<path d="M0 -150 L0 -190" stroke="#1e293b" stroke-width="6"/><circle class="ck-antenna" cx="0" cy="-196" r="12" fill="' + c.accent + '" stroke="#1e293b" stroke-width="5"/>';
      case 'human': return '<circle cx="-78" cy="-80" r="14" fill="' + c.skin + '" stroke="#3b1d14" stroke-width="5"/><circle cx="78" cy="-80" r="14" fill="' + c.skin + '" stroke="#3b1d14" stroke-width="5"/>';
      default: return '';
    }
  }
  function hairShape(k, c) {
    if (!c.hair) return '';
    if (k.beard) return '<path d="M-70 -110 Q0 -190 70 -110 Q50 -150 0 -158 Q-50 -150 -70 -110 Z" fill="' + c.hair + '" stroke="#3b1d14" stroke-width="5"/><path d="M-50 -40 Q0 20 50 -40 Q30 -10 0 -12 Q-30 -10 -50 -40 Z" fill="' + c.hair + '" stroke="#3b1d14" stroke-width="5"/>';
    return '<path d="M-80 -92 Q-86 -176 0 -170 Q86 -176 80 -92 Q64 -132 30 -128 Q36 -146 10 -150 Q-6 -126 -40 -132 Q-60 -128 -80 -92 Z" fill="' + c.hair + '" stroke="#3b1d14" stroke-width="5" stroke-linejoin="round"/>';
  }

  /** SVG markup for one character. Returns a <g> to place inside a full-frame <svg>. */
  function character(o) {
    o = o || {};
    var k = KINDS[o.kind || 'kid'] || KINDS.kid;
    var c = Object.assign({}, k, o.palette || {});
    var id = o.id || 'ck' + Math.floor(Math.random() * 1e6);
    var s = o.scale || 1;
    var human = k.limbs === 'human';
    var outfit = c.body;
    var limb = human ? c.skin : shade(c.body, -10);
    var tail = k.tail ? '<path class="ck-tail" d="M40 -60 Q120 -70 120 -150 Q118 -110 70 -96" fill="none" stroke="' + (o.kind === 'fox' ? c.body : shade(c.body, -15)) + '" stroke-width="22" stroke-linecap="round"/>' + (o.kind === 'fox' ? '<circle cx="120" cy="-150" r="14" fill="#fff"/>' : '') : '';
    var wings = k.wings ? '<g class="ck-wing-l"><path d="M-40 -120 Q-150 -200 -170 -110 Q-120 -130 -100 -90 Q-80 -110 -40 -90 Z" fill="' + shade(c.body, -20) + '" stroke="#3b1d14" stroke-width="5"/></g><g class="ck-wing-r"><path d="M40 -120 Q150 -200 170 -110 Q120 -130 100 -90 Q80 -110 40 -90 Z" fill="' + shade(c.body, -20) + '" stroke="#3b1d14" stroke-width="5"/></g>' : '';
    var beak = k.beak ? '<path d="M-14 -62 L14 -62 L0 -40 Z" fill="' + c.accent + '" stroke="#3b1d14" stroke-width="4"/>' : '';
    var mouthG = '<g class="ck-mouth" transform="translate(0 -46)">' + Object.keys(MOUTHS).map(function (m) { return MOUTHS[m].replace('class="m ', 'style="opacity:' + (m === 'closed' ? 1 : 0) + '" class="m '); }).join('') + '</g>';
    var eyes =
      '<g class="ck-eyes">' +
      '<g class="ck-eye ck-eye-l" transform="translate(-28 -96)"><ellipse rx="15" ry="19" fill="#fff" stroke="#3b1d14" stroke-width="4"/><circle class="ck-pupil" cx="2" cy="3" r="8" fill="#1f2937"/><circle cx="5" cy="-1" r="3" fill="#fff"/></g>' +
      '<g class="ck-eye ck-eye-r" transform="translate(28 -96)"><ellipse rx="15" ry="19" fill="#fff" stroke="#3b1d14" stroke-width="4"/><circle class="ck-pupil" cx="2" cy="3" r="8" fill="#1f2937"/><circle cx="5" cy="-1" r="3" fill="#fff"/></g>' +
      '</g>' +
      '<g class="ck-brows"><path class="ck-brow-l" d="M-44 -126 Q-28 -134 -12 -126" fill="none" stroke="#3b1d14" stroke-width="6" stroke-linecap="round"/><path class="ck-brow-r" d="M12 -126 Q28 -134 44 -126" fill="none" stroke="#3b1d14" stroke-width="6" stroke-linecap="round"/></g>' +
      '<g class="ck-blush" style="opacity:.0"><ellipse cx="-48" cy="-62" rx="14" ry="8" fill="#fb7185"/><ellipse cx="48" cy="-62" rx="14" ry="8" fill="#fb7185"/></g>' +
      '<g class="ck-tears" style="opacity:0"><path class="ck-tear ck-tear-l" d="M-34 -78 q-6 14 0 22 q6 -8 0 -22 Z" fill="#7dd3fc"/><path class="ck-tear ck-tear-r" d="M34 -78 q-6 14 0 22 q6 -8 0 -22 Z" fill="#7dd3fc"/></g>';
    var bodyShape = k.head === 'blob'
      ? ''
      : '<rect class="ck-torso" x="-56" y="-20" width="112" height="' + (human ? 120 : 100) + '" rx="44" fill="' + outfit + '" stroke="#3b1d14" stroke-width="6"/>' +
        (k.head === 'robot' ? '<circle cx="0" cy="34" r="16" fill="' + c.accent + '" stroke="#1e293b" stroke-width="4"/>' : '<path d="M-56 30 L56 30" stroke="' + shade(outfit, -25) + '" stroke-width="6"/>') +
        (o.kind === 'robot' ? '<path d="M-40 52 Q0 76 40 52 L40 64 Q0 90 -40 64 Z" fill="#fff" stroke="#1e293b" stroke-width="4"/>' : '');
    var legs = k.head === 'blob' ? '' :
      '<g class="ck-leg ck-leg-l" transform="translate(-24 90)"><rect x="-13" y="0" width="26" height="' + (human ? 70 : 46) + '" rx="12" fill="' + (human ? c.accent : limb) + '" stroke="#3b1d14" stroke-width="5"/><ellipse cx="-4" cy="' + (human ? 72 : 48) + '" rx="22" ry="11" fill="#1f2937"/></g>' +
      '<g class="ck-leg ck-leg-r" transform="translate(24 90)"><rect x="-13" y="0" width="26" height="' + (human ? 70 : 46) + '" rx="12" fill="' + (human ? c.accent : limb) + '" stroke="#3b1d14" stroke-width="5"/><ellipse cx="4" cy="' + (human ? 72 : 48) + '" rx="22" ry="11" fill="#1f2937"/></g>';
    var arms = k.head === 'blob' ? '' :
      '<g class="ck-arm ck-arm-l" transform="translate(-56 0)"><rect x="-12" y="-6" width="24" height="84" rx="12" fill="' + limb + '" stroke="#3b1d14" stroke-width="5"/><circle cx="0" cy="80" r="15" fill="' + (human ? c.skin : c.accent) + '" stroke="#3b1d14" stroke-width="5"/></g>' +
      '<g class="ck-arm ck-arm-r" transform="translate(56 0)"><rect x="-12" y="-6" width="24" height="84" rx="12" fill="' + limb + '" stroke="#3b1d14" stroke-width="5"/><circle cx="0" cy="80" r="15" fill="' + (human ? c.skin : c.accent) + '" stroke="#3b1d14" stroke-width="5"/></g>';
    var feetY = k.head === 'blob' ? 0 : human ? 172 : 148;
    return (
      '<g id="' + id + '" class="ck-char" data-kind="' + (o.kind || 'kid') + '" transform="translate(' + (o.x || 0) + ' ' + (o.y || 0) + ')">' +
      '<g class="ck-flip"><g class="ck-pos"><g class="ck-root" transform="scale(' + s + ') translate(0 ' + -feetY + ')">' +
      '<ellipse class="ck-shadow" cx="0" cy="' + (feetY + 4) + '" rx="70" ry="12" fill="#000" opacity=".18"/>' +
      tail + wings + legs + arms + bodyShape +
      '<g class="ck-head">' + earsShape(k, c) + headShape(k, c) + hairShape(k, c) + eyes + beak + mouthG + '</g>' +
      '</g></g></g></g>'
    );
  }

  // ── actions ────────────────────────────────────────────────────────────
  var EMO = {
    neutral:   { mouth: 'closed', browL: 0, browR: 0, browY: 0, eye: 1, blush: 0, tears: 0 },
    happy:     { mouth: 'smile', browL: 0, browR: 0, browY: -4, eye: 0.85, blush: 0.6, tears: 0 },
    laugh:     { mouth: 'laugh', browL: 0, browR: 0, browY: -8, eye: 0.25, blush: 0.8, tears: 0 },
    sad:       { mouth: 'sad', browL: -16, browR: 16, browY: 4, eye: 0.8, blush: 0, tears: 0 },
    cry:       { mouth: 'open', browL: -20, browR: 20, browY: 6, eye: 0.35, blush: 0.4, tears: 1 },
    surprised: { mouth: 'o', browL: 0, browR: 0, browY: -14, eye: 1.25, blush: 0, tears: 0 },
    angry:     { mouth: 'flat', browL: 18, browR: -18, browY: 6, eye: 0.9, blush: 0, tears: 0 },
    worried:   { mouth: 'flat', browL: -12, browR: 12, browY: -2, eye: 1, blush: 0, tears: 0 },
    excited:   { mouth: 'laugh', browL: 0, browR: 0, browY: -12, eye: 1.15, blush: 0.7, tears: 0 },
  };

  function setMouth(tl, S, m, at) {
    Object.keys(MOUTHS).forEach(function (k) {
      if (has(S + ' .m-' + k)) tl.set(S + ' .m-' + k, { opacity: k === m ? 1 : 0 }, at);
    });
  }

  /**
   * Add an action to a GSAP timeline. `sel` is the character's #id.
   * Actions: idle, blink, emote, talk, walk, run, jump, fly, wave, point, hug, turn, enter, exit, look, shake, bounce, float.
   */
  function act(tl, sel, action, at, o) {
    o = o || {};
    at = at || 0;
    var S = sel;
    var dur = o.dur || 1;
    var root = S + ' .ck-root';
    var pos = S + ' .ck-pos';
    switch (action) {
      case 'idle': {
        // Breathing bob and a slow sway, looped to cover `dur`.
        var n = Math.max(1, Math.round(dur / 1.6));
        tl.to(root, { y: '-=6', duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: n * 2 - 1, transformOrigin: '50% 100%' }, at);
        if (has(S + ' .ck-tail')) tl.to(S + ' .ck-tail', { rotation: 10, duration: 0.6, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.6)) - 1, ease: 'sine.inOut', transformOrigin: '0% 100%' }, at);
        if (has(S + ' .ck-antenna')) tl.to(S + ' .ck-antenna', { scale: 1.3, duration: 0.5, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.5)) - 1, transformOrigin: '50% 50%' }, at);
        break;
      }
      case 'blink': {
        tl.to(S + ' .ck-eye', { scaleY: 0.1, duration: 0.06, yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, at);
        break;
      }
      case 'emote': {
        var e = EMO[o.emotion] || EMO.neutral;
        setMouth(tl, S, e.mouth, at);
        tl.to(S + ' .ck-brow-l', { rotation: e.browL, y: e.browY, duration: 0.25, ease: 'power2.out', transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .ck-brow-r', { rotation: e.browR, y: e.browY, duration: 0.25, ease: 'power2.out', transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .ck-eye', { scaleY: e.eye, scaleX: o.emotion === 'surprised' ? 1.15 : 1, duration: 0.2, transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .ck-blush', { opacity: e.blush, duration: 0.3 }, at);
        tl.to(S + ' .ck-tears', { opacity: e.tears, duration: 0.2 }, at);
        if (e.tears) {
          var reps = Math.max(1, Math.round((o.dur || 2) / 0.7));
          tl.fromTo(S + ' .ck-tear', { y: 0, opacity: 1 }, { y: 60, opacity: 0, duration: 0.7, ease: 'power1.in', repeat: reps - 1, stagger: 0.25 }, at + 0.1);
          tl.to(root, { y: '+=4', duration: 0.18, yoyo: true, repeat: reps * 2 - 1, ease: 'sine.inOut' }, at);
        }
        if (o.emotion === 'surprised' || o.emotion === 'excited') tl.fromTo(root, { scaleY: 1 }, { scaleY: 1.06, duration: 0.15, yoyo: true, repeat: 1, transformOrigin: '50% 100%' }, at);
        if (o.emotion === 'laugh') tl.to(S + ' .ck-head', { rotation: 4, duration: 0.12, yoyo: true, repeat: Math.max(1, Math.round((o.dur || 1.5) / 0.12)) - 1, transformOrigin: '50% 95%' }, at);
        break;
      }
      case 'talk': {
        // Mouth flaps; pass words [{start, end}] (seconds from `at`) to sync with a voice line.
        var words = o.words || [];
        if (!words.length) { var t = 0; while (t < dur) { words.push({ start: t, end: t + 0.18 }); t += 0.28 + ((t * 7) % 3) * 0.05; } }
        var rest = o.rest || 'closed';
        words.forEach(function (w, i) {
          setMouth(tl, S, i % 3 === 2 ? 'o' : 'open', at + w.start);
          setMouth(tl, S, rest, at + Math.max(w.start + 0.08, w.end));
        });
        tl.to(S + ' .ck-head', { rotation: 2, duration: 0.3, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.3)) - 1, ease: 'sine.inOut', transformOrigin: '50% 95%' }, at);
        break;
      }
      case 'walk':
      case 'run': {
        var step = action === 'run' ? 0.22 : 0.36;
        var steps = Math.max(2, Math.round(dur / step));
        var swing = action === 'run' ? 34 : 22;
        tl.to(pos, { x: '+=' + (o.by || 300), duration: dur, ease: 'none' }, at);
        tl.fromTo(S + ' .ck-leg-l', { rotation: -swing }, { rotation: swing, duration: step, yoyo: true, repeat: steps - 1, ease: 'sine.inOut', transformOrigin: '50% 0%' }, at);
        tl.fromTo(S + ' .ck-leg-r', { rotation: swing }, { rotation: -swing, duration: step, yoyo: true, repeat: steps - 1, ease: 'sine.inOut', transformOrigin: '50% 0%' }, at);
        tl.fromTo(S + ' .ck-arm-l', { rotation: swing }, { rotation: -swing, duration: step, yoyo: true, repeat: steps - 1, ease: 'sine.inOut', transformOrigin: '50% 8%' }, at);
        tl.fromTo(S + ' .ck-arm-r', { rotation: -swing }, { rotation: swing, duration: step, yoyo: true, repeat: steps - 1, ease: 'sine.inOut', transformOrigin: '50% 8%' }, at);
        tl.to(root, { y: action === 'run' ? -14 : -8, duration: step / 2, yoyo: true, repeat: steps * 2 - 1, ease: 'sine.inOut' }, at);
        tl.set([S + ' .ck-leg', S + ' .ck-arm'], { rotation: 0 }, at + dur);
        break;
      }
      case 'jump': {
        var h = o.height || 160;
        tl.to(root, { scaleY: 0.86, duration: 0.12, transformOrigin: '50% 100%' }, at);
        tl.to(pos, { y: '-=' + h, duration: dur * 0.45, ease: 'power2.out' }, at + 0.12);
        tl.to(root, { scaleY: 1.08, duration: 0.15, transformOrigin: '50% 100%' }, at + 0.12);
        tl.to(pos, { y: '+=' + h, duration: dur * 0.45, ease: 'power2.in' }, at + 0.12 + dur * 0.45);
        tl.to(root, { scaleY: 0.9, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: '50% 100%' }, at + 0.12 + dur * 0.9);
        tl.to([S + ' .ck-arm-l'], { rotation: 150, duration: 0.2, transformOrigin: '50% 8%' }, at + 0.1);
        tl.to([S + ' .ck-arm-r'], { rotation: -150, duration: 0.2, transformOrigin: '50% 8%' }, at + 0.1);
        tl.to([S + ' .ck-arm-l', S + ' .ck-arm-r'], { rotation: 0, duration: 0.3 }, at + dur);
        break;
      }
      case 'fly': {
        // Along points [[x,y],...] relative to the start, arms forward, wings flapping.
        var pts = o.path || [[300, -200], [700, -260]];
        var seg = dur / pts.length;
        pts.forEach(function (p, i) { tl.to(pos, { x: p[0], y: p[1], duration: seg, ease: i === pts.length - 1 ? 'power2.out' : 'sine.inOut' }, at + i * seg); });
        tl.to(S + ' .ck-arm-l', { rotation: 160, duration: 0.3, transformOrigin: '50% 8%' }, at);
        tl.to(S + ' .ck-arm-r', { rotation: -160, duration: 0.3, transformOrigin: '50% 8%' }, at);
        tl.to(root, { rotation: o.lean == null ? 8 : o.lean, duration: 0.4, transformOrigin: '50% 60%' }, at);
        if (has(S + ' .ck-wing-l')) {
          var fl = Math.max(2, Math.round(dur / 0.18));
          tl.to(S + ' .ck-wing-l', { rotation: -30, duration: 0.18, yoyo: true, repeat: fl - 1, transformOrigin: '100% 70%' }, at);
          tl.to(S + ' .ck-wing-r', { rotation: 30, duration: 0.18, yoyo: true, repeat: fl - 1, transformOrigin: '0% 70%' }, at);
        }
        tl.to(S + ' .ck-shadow', { opacity: 0.05, duration: 0.3 }, at);
        break;
      }
      case 'wave': {
        tl.to(S + ' .ck-arm-r', { rotation: -150, duration: 0.25, transformOrigin: '50% 8%' }, at);
        tl.to(S + ' .ck-arm-r', { rotation: -120, duration: 0.2, yoyo: true, repeat: Math.max(1, Math.round((dur - 0.5) / 0.2)) - 1, ease: 'sine.inOut', transformOrigin: '50% 8%' }, at + 0.25);
        tl.to(S + ' .ck-arm-r', { rotation: 0, duration: 0.25, transformOrigin: '50% 8%' }, at + dur - 0.25);
        break;
      }
      case 'point': {
        tl.to(S + ' .ck-arm-r', { rotation: o.up ? -130 : -90, duration: 0.3, ease: 'back.out(2)', transformOrigin: '50% 8%' }, at);
        tl.to(S + ' .ck-arm-r', { rotation: 0, duration: 0.3, transformOrigin: '50% 8%' }, at + dur);
        break;
      }
      case 'hug': {
        tl.to(S + ' .ck-arm-l', { rotation: -60, duration: 0.3, transformOrigin: '50% 8%' }, at);
        tl.to(S + ' .ck-arm-r', { rotation: 60, duration: 0.3, transformOrigin: '50% 8%' }, at);
        tl.to(root, { scaleX: 1.04, scaleY: 0.97, duration: 0.25, yoyo: true, repeat: 1, transformOrigin: '50% 100%' }, at + 0.2);
        tl.to([S + ' .ck-arm-l', S + ' .ck-arm-r'], { rotation: 0, duration: 0.3 }, at + dur);
        break;
      }
      case 'turn': {
        tl.to(S + ' .ck-flip', { scaleX: o.face === 'left' ? -1 : 1, duration: 0.2, ease: 'power2.inOut', transformOrigin: '50% 50%' }, at);
        break;
      }
      case 'look': {
        var dx = o.dir === 'left' ? -5 : o.dir === 'right' ? 5 : 0;
        var dy = o.dir === 'up' ? -5 : o.dir === 'down' ? 5 : 0;
        tl.to(S + ' .ck-pupil', { x: dx, y: dy, duration: 0.2 }, at);
        break;
      }
      case 'enter': {
        var from = o.from || 'left';
        var off = from === 'left' ? -900 : from === 'right' ? 900 : 0;
        if (from === 'bottom') tl.fromTo(pos, { y: 600 }, { y: 0, duration: dur, ease: 'back.out(1.4)' }, at);
        else if (from === 'pop') tl.fromTo(root, { scale: 0 }, { scale: 1, duration: dur, ease: 'back.out(2)', transformOrigin: '50% 100%' }, at);
        else act(tl, sel, 'walk', at, { by: -off, dur: dur }), tl.set(pos, { x: off }, at);
        break;
      }
      case 'exit': {
        act(tl, sel, 'walk', at, { by: o.to === 'left' ? -1200 : 1200, dur: dur });
        break;
      }
      case 'shake': {
        tl.to(pos, { x: '+=10', duration: 0.05, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.05)) - 1 }, at);
        break;
      }
      case 'bounce': {
        tl.to(pos, { y: '-=40', duration: 0.22, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.22)) - 1, ease: 'sine.out' }, at);
        break;
      }
      case 'float': {
        tl.to(pos, { y: '-=24', duration: 1.2, yoyo: true, repeat: Math.max(1, Math.round(dur / 1.2)) - 1, ease: 'sine.inOut' }, at);
        break;
      }
    }
    return tl;
  }

  // ── worlds ─────────────────────────────────────────────────────────────
  var SKY = {
    day: ['#7dd3fc', '#e0f2fe'], evening: ['#f97316', '#fde68a'], dusk: ['#6d28d9', '#f472b6'], night: ['#0b1026', '#312e81'], dawn: ['#fda4af', '#fef3c7'],
  };
  function sky(w, h, time, id) {
    var c = SKY[time] || SKY.day;
    return '<defs><linearGradient id="' + id + '-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#' + id + '-sky)"/>';
  }
  function stars(w, h, n, seed) {
    var r = rng(seed); var out = '';
    for (var i = 0; i < n; i++) out += '<circle class="ck-star" cx="' + (r() * w).toFixed(0) + '" cy="' + (r() * h * 0.6).toFixed(0) + '" r="' + (1 + r() * 2.5).toFixed(1) + '" fill="#fff" opacity="' + (0.4 + r() * 0.6).toFixed(2) + '"/>';
    return out;
  }
  function clouds(w, h, n, seed, col) {
    var r = rng(seed); var out = '';
    for (var i = 0; i < n; i++) {
      var x = r() * w, y = 60 + r() * h * 0.35, s = 0.6 + r() * 1.1;
      out += '<g class="ck-cloud" transform="translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ') scale(' + s.toFixed(2) + ')"><ellipse cx="0" cy="0" rx="90" ry="34" fill="' + (col || '#fff') + '" opacity=".92"/><ellipse cx="-50" cy="8" rx="56" ry="28" fill="' + (col || '#fff') + '" opacity=".92"/><ellipse cx="56" cy="6" rx="60" ry="26" fill="' + (col || '#fff') + '" opacity=".92"/></g>';
    }
    return out;
  }
  function hills(w, h, y, col, seed) {
    var r = rng(seed); var d = 'M0 ' + h + ' L0 ' + y;
    for (var x = 0; x <= w; x += 160) d += ' Q' + (x + 80) + ' ' + (y - 40 - r() * 80).toFixed(0) + ' ' + (x + 160) + ' ' + y;
    return '<path d="' + d + ' L' + w + ' ' + h + ' Z" fill="' + col + '"/>';
  }
  function trees(w, y, n, seed, col) {
    var r = rng(seed); var out = '';
    for (var i = 0; i < n; i++) {
      var x = (i + 0.3 + r() * 0.4) * (w / n), s = 0.7 + r() * 0.8;
      out += '<g transform="translate(' + x.toFixed(0) + ' ' + y + ') scale(' + s.toFixed(2) + ')"><rect x="-10" y="-70" width="20" height="70" fill="#78350f"/><circle cx="0" cy="-110" r="56" fill="' + (col || '#16a34a') + '"/><circle cx="-34" cy="-80" r="38" fill="' + shade(col || '#16a34a', -18) + '"/><circle cx="34" cy="-84" r="40" fill="' + shade(col || '#16a34a', 12) + '"/></g>';
    }
    return out;
  }
  function island(x, y, s, col, seed) {
    var r = rng(seed);
    var top = col || '#4ade80';
    var falls = r() > 0.4 ? '<rect class="ck-fall" x="' + (40 * s) + '" y="' + (10 * s) + '" width="' + (16 * s) + '" height="' + (260 * s) + '" fill="#a5f3fc" opacity=".85"/>' : '';
    return '<g class="ck-island" transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M-160 0 Q0 -30 160 0 L90 70 L30 160 L-20 120 L-80 80 Z" fill="#92400e"/><path d="M-160 0 Q0 -30 160 0 Q150 22 0 26 Q-150 22 -160 0 Z" fill="' + top + '"/>' + trees(240, -4, 2, seed + 3, '#22c55e').replace(/<g transform="translate\(/g, '<g transform="translate(-120 0) translate(') + falls + '</g>';
  }

  /** Full-frame illustrated background with parallax layers (.ck-far, .ck-mid, .ck-near). */
  function world(kind, o) {
    o = o || {};
    var w = o.w || 1920, h = o.h || 1080, time = o.time || 'day', id = o.id || 'w' + kind;
    var seed = o.seed || 7;
    var gy = h * 0.78;
    var far = '', mid = '', near = '';
    switch (kind) {
      case 'bedroom':
      case 'classroom':
      case 'kitchen': {
        var wall = kind === 'bedroom' ? '#c7d2fe' : kind === 'classroom' ? '#fef3c7' : '#d1fae5';
        far = '<rect width="' + w + '" height="' + h + '" fill="' + wall + '"/><rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="' + (kind === 'kitchen' ? '#e5e7eb' : '#a16207') + '"/>';
        var win = '<g transform="translate(' + (w * 0.62) + ' ' + (h * 0.14) + ')"><rect width="360" height="300" rx="14" fill="#1e293b"/><rect x="14" y="14" width="332" height="272" fill="' + (time === 'night' ? '#1e1b4b' : time === 'evening' ? '#fdba74' : '#7dd3fc') + '"/>' + (time === 'night' ? '<circle cx="250" cy="90" r="34" fill="#fef9c3"/>' + stars(330, 260, 18, seed) : clouds(330, 200, 2, seed, '#fff')) + '<rect x="173" y="14" width="14" height="272" fill="#1e293b"/><rect x="14" y="143" width="332" height="14" fill="#1e293b"/></g>';
        if (kind === 'bedroom') mid = win + '<g transform="translate(' + (w * 0.08) + ' ' + (gy - 200) + ')"><rect width="460" height="200" rx="20" fill="#f472b6"/><rect x="0" y="-60" width="70" height="260" rx="14" fill="#9d174d"/><rect x="20" y="20" width="150" height="70" rx="24" fill="#fff"/></g><g transform="translate(' + (w * 0.42) + ' ' + (gy - 160) + ')"><rect width="260" height="16" fill="#78350f"/><rect x="20" y="16" width="16" height="144" fill="#78350f"/><rect x="224" y="16" width="16" height="144" fill="#78350f"/><rect x="40" y="-40" width="60" height="40" fill="#60a5fa"/><rect x="110" y="-30" width="50" height="30" fill="#f87171"/></g>';
        if (kind === 'classroom') mid = '<g transform="translate(' + (w * 0.2) + ' ' + (h * 0.12) + ')"><rect width="900" height="380" rx="10" fill="#14532d" stroke="#78350f" stroke-width="20"/><path d="M60 120 Q200 60 340 140" stroke="#fff" stroke-width="5" fill="none" opacity=".7"/></g>' + win.replace('0.62', '0.8');
        if (kind === 'kitchen') mid = '<rect x="0" y="' + (gy - 220) + '" width="' + w + '" height="220" fill="#f8fafc"/><rect x="0" y="' + (gy - 240) + '" width="' + w + '" height="24" fill="#94a3b8"/>' + win;
        break;
      }
      case 'street':
      case 'park':
      case 'city-night': {
        var night = kind === 'city-night';
        far = sky(w, h, night ? 'night' : time, id) + (night ? stars(w, h, 60, seed) : clouds(w, h, 4, seed));
        var r = rng(seed + 1), bld = '';
        for (var bx = 0; bx < w; bx += 140 + Math.floor(r() * 80)) {
          var bh = 200 + r() * 360, bw = 120 + r() * 80;
          bld += '<rect x="' + bx + '" y="' + (gy - bh) + '" width="' + bw.toFixed(0) + '" height="' + bh.toFixed(0) + '" fill="' + (night ? '#1e293b' : ['#fca5a5', '#fde68a', '#a7f3d0', '#c4b5fd'][Math.floor(r() * 4)]) + '"/>';
          for (var wy = gy - bh + 24; wy < gy - 30; wy += 46) for (var wx = bx + 16; wx < bx + bw - 24; wx += 36) bld += '<rect class="ck-window" x="' + wx.toFixed(0) + '" y="' + wy.toFixed(0) + '" width="18" height="24" fill="' + (night ? (r() > 0.45 ? '#fde047' : '#334155') : '#e0f2fe') + '"/>';
        }
        mid = kind === 'park' ? hills(w, h, gy - 40, '#86efac', seed) + trees(w, gy - 20, 6, seed, '#16a34a') : bld;
        near = '<rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="' + (kind === 'park' ? '#4ade80' : night ? '#0f172a' : '#9ca3af') + '"/>' + (kind === 'park' ? '' : '<rect y="' + (gy + 60) + '" width="' + w + '" height="10" fill="' + (night ? '#475569' : '#e5e7eb') + '" stroke-dasharray="60 40"/>');
        break;
      }
      case 'sky':
      case 'floating-islands': {
        far = sky(w, h, time, id) + (time === 'night' ? stars(w, h, 70, seed) : '') + clouds(w, h, 6, seed, time === 'night' ? '#475569' : '#fff');
        if (kind === 'floating-islands') {
          mid = island(w * 0.2, h * 0.45, 0.9, '#4ade80', seed) + island(w * 0.72, h * 0.32, 1.2, '#86efac', seed + 5) + island(w * 0.5, h * 0.7, 0.6, '#bbf7d0', seed + 9);
          near = '<g class="ck-rainbow" opacity=".55"><path d="M' + (w * 0.1) + ' ' + h + ' A' + (w * 0.4) + ' ' + (w * 0.4) + ' 0 0 1 ' + (w * 0.9) + ' ' + h + '" stroke="#f472b6" stroke-width="28" fill="none"/><path d="M' + (w * 0.13) + ' ' + h + ' A' + (w * 0.37) + ' ' + (w * 0.37) + ' 0 0 1 ' + (w * 0.87) + ' ' + h + '" stroke="#facc15" stroke-width="28" fill="none"/><path d="M' + (w * 0.16) + ' ' + h + ' A' + (w * 0.34) + ' ' + (w * 0.34) + ' 0 0 1 ' + (w * 0.84) + ' ' + h + '" stroke="#38bdf8" stroke-width="28" fill="none"/></g>';
        } else near = clouds(w, h * 2.4, 3, seed + 11, '#fff').replace(/ck-cloud/g, 'ck-cloud ck-cloud-near');
        break;
      }
      case 'forest':
      case 'mountains': {
        far = sky(w, h, time, id) + (time === 'night' ? stars(w, h, 50, seed) : clouds(w, h, 3, seed));
        if (kind === 'mountains') far += '<path d="M0 ' + gy + ' L' + (w * 0.22) + ' ' + (h * 0.25) + ' L' + (w * 0.42) + ' ' + gy + ' Z" fill="#64748b"/><path d="M' + (w * 0.3) + ' ' + gy + ' L' + (w * 0.6) + ' ' + (h * 0.15) + ' L' + (w * 0.9) + ' ' + gy + ' Z" fill="#475569"/><path d="M' + (w * 0.56) + ' ' + (h * 0.21) + ' L' + (w * 0.6) + ' ' + (h * 0.15) + ' L' + (w * 0.64) + ' ' + (h * 0.21) + ' Z" fill="#fff"/>';
        mid = hills(w, h, gy - 60, kind === 'forest' ? '#166534' : '#4d7c0f', seed) + trees(w, gy - 40, kind === 'forest' ? 9 : 4, seed + 2, '#15803d');
        near = '<rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="#65a30d"/>' + trees(w, h + 60, 4, seed + 4, '#14532d');
        break;
      }
      case 'beach':
      case 'underwater': {
        if (kind === 'beach') {
          far = sky(w, h, time, id) + '<circle cx="' + (w * 0.78) + '" cy="' + (h * 0.25) + '" r="80" fill="#fde047"/>' + clouds(w, h, 3, seed);
          mid = '<rect y="' + (h * 0.55) + '" width="' + w + '" height="' + (h * 0.25) + '" fill="#0ea5e9"/><path class="ck-wave" d="M0 ' + (h * 0.58) + ' Q' + (w * 0.125) + ' ' + (h * 0.55) + ' ' + (w * 0.25) + ' ' + (h * 0.58) + ' T' + (w * 0.5) + ' ' + (h * 0.58) + ' T' + (w * 0.75) + ' ' + (h * 0.58) + ' T' + w + ' ' + (h * 0.58) + '" stroke="#e0f2fe" stroke-width="8" fill="none"/>';
          near = '<rect y="' + (h * 0.78) + '" width="' + w + '" height="' + (h * 0.22) + '" fill="#fde68a"/>';
        } else {
          far = '<defs><linearGradient id="' + id + '-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0891b2"/><stop offset="1" stop-color="#082f49"/></linearGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#' + id + '-sea)"/>';
          var rb = rng(seed), bub = '';
          for (var i = 0; i < 26; i++) bub += '<circle class="ck-bubble" cx="' + (rb() * w).toFixed(0) + '" cy="' + (rb() * h).toFixed(0) + '" r="' + (4 + rb() * 10).toFixed(0) + '" fill="none" stroke="#a5f3fc" stroke-width="3" opacity=".6"/>';
          mid = bub;
          near = '<rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="#a16207"/>' + '<path d="M200 ' + gy + ' Q180 ' + (gy - 160) + ' 220 ' + (gy - 260) + '" stroke="#16a34a" stroke-width="16" fill="none"/><path d="M1600 ' + gy + ' Q1640 ' + (gy - 140) + ' 1600 ' + (gy - 240) + '" stroke="#16a34a" stroke-width="16" fill="none"/>';
        }
        break;
      }
      case 'space': {
        far = '<rect width="' + w + '" height="' + h + '" fill="#020617"/>' + stars(w, h * 1.6, 160, seed) + '<circle cx="' + (w * 0.2) + '" cy="' + (h * 0.3) + '" r="140" fill="#7c3aed" opacity=".25"/>';
        mid = '<circle cx="' + (w * 0.78) + '" cy="' + (h * 0.32) + '" r="120" fill="#f97316"/><ellipse cx="' + (w * 0.78) + '" cy="' + (h * 0.32) + '" rx="200" ry="34" fill="none" stroke="#fdba74" stroke-width="10" transform="rotate(-14 ' + (w * 0.78) + ' ' + (h * 0.32) + ')"/>';
        near = '<path d="M0 ' + h + ' Q' + (w * 0.5) + ' ' + (h * 0.72) + ' ' + w + ' ' + h + ' Z" fill="#94a3b8"/>';
        break;
      }
      case 'battlefield': {
        far = sky(w, h, time === 'day' ? 'dusk' : time, id) + (time === 'night' || time === 'dusk' ? stars(w, h, 40, seed) : '') + '<circle cx="' + (w * 0.5) + '" cy="' + (h * 0.42) + '" r="160" fill="#fca5a5" opacity=".35"/>';
        mid = '<path d="M0 ' + gy + ' L' + (w * 0.15) + ' ' + (gy - 120) + ' L' + (w * 0.3) + ' ' + (gy - 40) + ' L' + (w * 0.55) + ' ' + (gy - 160) + ' L' + (w * 0.8) + ' ' + (gy - 60) + ' L' + w + ' ' + (gy - 140) + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="#292524"/>';
        near = '<rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="#44403c"/><path class="ck-crack" d="M' + (w * 0.45) + ' ' + gy + ' l30 40 l-20 30 l40 50" stroke="#f97316" stroke-width="6" fill="none" opacity="0"/>';
        break;
      }
      default:
        far = sky(w, h, time, id) + clouds(w, h, 4, seed);
        near = '<rect y="' + gy + '" width="' + w + '" height="' + (h - gy) + '" fill="#86efac"/>';
    }
    return '<g id="' + id + '" class="ck-world" data-kind="' + kind + '"><g class="ck-far">' + far + '</g><g class="ck-mid">' + mid + '</g><g class="ck-near">' + near + '</g></g>';
  }

  /** Slow parallax drift so a background never sits still. */
  function parallax(tl, sel, at, o) {
    o = o || {};
    var dur = o.dur || 6, dx = o.dx == null ? -60 : o.dx;
    tl.fromTo(sel + ' .ck-far', { x: 0 }, { x: dx * 0.3, duration: dur, ease: 'none' }, at);
    tl.fromTo(sel + ' .ck-mid', { x: 0 }, { x: dx * 0.6, duration: dur, ease: 'none' }, at);
    tl.fromTo(sel + ' .ck-near', { x: 0 }, { x: dx, duration: dur, ease: 'none' }, at);
    if (has(sel + ' .ck-cloud')) tl.fromTo(sel + ' .ck-cloud', { x: 0 }, { x: dx * 0.8 - 40, duration: dur, ease: 'none' }, at);
    if (has(sel + ' .ck-star')) tl.to(sel + ' .ck-star', { opacity: 0.2, duration: 0.8, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.8)) - 1, stagger: { each: 0.07, from: 'random' } }, at);
    if (has(sel + ' .ck-island')) tl.to(sel + ' .ck-island', { y: '-=18', duration: 2, yoyo: true, repeat: Math.max(1, Math.round(dur / 2)) - 1, ease: 'sine.inOut', stagger: 0.6 }, at);
    if (has(sel + ' .ck-bubble')) tl.to(sel + ' .ck-bubble', { y: '-=160', duration: dur, ease: 'none', stagger: { each: 0.1, from: 'random' } }, at);
    if (has(sel + ' .ck-wave')) tl.to(sel + ' .ck-wave', { x: -60, duration: 2, yoyo: true, repeat: Math.max(1, Math.round(dur / 2)) - 1, ease: 'sine.inOut' }, at);
    return tl;
  }

  // ── effects ────────────────────────────────────────────────────────────
  /** Markup for an effect at (x, y). Animate it with CartoonKit.play(tl, '#id', kind, at, opts). */
  function fx(kind, o) {
    o = o || {};
    var id = o.id || 'fx-' + kind, x = o.x || 960, y = o.y || 540, s = o.scale || 1;
    var col = o.color || { 'portal-door': '#f472b6', sparkles: '#fde047', 'glow-aura': '#f97316', 'energy-orb': '#38bdf8', explosion: '#f97316', hearts: '#f43f5e', 'light-rays': '#fef08a', 'magic-trail': '#c084fc' }[kind] || '#fde047';
    var r = rng(o.seed || 11), inner = '';
    switch (kind) {
      case 'portal-door':
        inner = '<defs><radialGradient id="' + id + '-g"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="' + col + '"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs>' +
          '<ellipse class="fx-glow" cx="0" cy="-170" rx="240" ry="260" fill="url(#' + id + '-g)" opacity="0"/>' +
          '<rect x="-110" y="-360" width="220" height="360" rx="14" fill="#fde047" stroke="#a16207" stroke-width="8"/>' +
          '<rect class="fx-light" x="-96" y="-346" width="192" height="346" fill="#fff7ed"/>' +
          '<g class="fx-door"><rect x="-96" y="-346" width="192" height="346" rx="8" fill="' + col + '" stroke="#9d174d" stroke-width="6"/><circle cx="64" cy="-170" r="12" fill="#fde047"/></g>';
        break;
      case 'sparkles':
        for (var i = 0; i < (o.count || 24); i++) {
          var a = r() * Math.PI * 2, d = 40 + r() * (o.radius || 260), ss = 6 + r() * 12;
          inner += '<g transform="translate(' + (Math.cos(a) * d).toFixed(0) + ' ' + (Math.sin(a) * d).toFixed(0) + ')"><path class="fx-p" d="M0 ' + -ss + ' L' + ss * 0.3 + ' ' + -ss * 0.3 + ' L' + ss + ' 0 L' + ss * 0.3 + ' ' + ss * 0.3 + ' L0 ' + ss + ' L' + -ss * 0.3 + ' ' + ss * 0.3 + ' L' + -ss + ' 0 L' + -ss * 0.3 + ' ' + -ss * 0.3 + ' Z" fill="' + (r() > 0.3 ? col : '#fff') + '" opacity="0"/></g>';
        }
        break;
      case 'glow-aura':
        inner = '<defs><radialGradient id="' + id + '-g"><stop offset="0" stop-color="' + col + '" stop-opacity=".9"/><stop offset=".6" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs><ellipse class="fx-glow" cx="0" cy="-160" rx="190" ry="260" fill="url(#' + id + '-g)" opacity="0"/>';
        for (var j = 0; j < 14; j++) inner += '<path class="fx-flame" d="M' + (-120 + j * 18) + ' 0 Q' + (-130 + j * 18) + ' ' + (-120 - r() * 120).toFixed(0) + ' ' + (-110 + j * 18) + ' ' + (-200 - r() * 140).toFixed(0) + '" stroke="' + col + '" stroke-width="10" fill="none" stroke-linecap="round" opacity="0"/>';
        break;
      case 'energy-orb':
        inner = '<defs><radialGradient id="' + id + '-g"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="' + col + '"/><stop offset=".7" stop-color="' + shade(col, -60) + '" stop-opacity=".6"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs><circle class="fx-orb" r="120" fill="url(#' + id + '-g)" style="transform:scale(0)"/>' +
          '<g class="fx-ring"><ellipse rx="150" ry="46" fill="none" stroke="#fde047" stroke-width="6" opacity=".8"/><ellipse rx="46" ry="150" fill="none" stroke="#fff" stroke-width="4" opacity=".6"/></g>';
        break;
      case 'explosion':
        inner = '<circle class="fx-flash" r="60" fill="#fff" opacity="0"/><g class="fx-rays">';
        for (var k = 0; k < 18; k++) { var aa = (k / 18) * Math.PI * 2; inner += '<path class="fx-ray" d="M0 0 L' + (Math.cos(aa - 0.08) * 420).toFixed(0) + ' ' + (Math.sin(aa - 0.08) * 420).toFixed(0) + ' L' + (Math.cos(aa + 0.08) * 420).toFixed(0) + ' ' + (Math.sin(aa + 0.08) * 420).toFixed(0) + ' Z" fill="' + (k % 2 ? col : '#fde047') + '" opacity="0"/>'; }
        inner += '</g><circle class="fx-ring" r="80" fill="none" stroke="#fff" stroke-width="18" opacity="0"/>';
        break;
      case 'speed-lines':
        for (var l = 0; l < 30; l++) { var yy = (r() - 0.5) * 1000; inner += '<rect class="fx-line" x="' + (-1100 + r() * 400).toFixed(0) + '" y="' + yy.toFixed(0) + '" width="' + (300 + r() * 500).toFixed(0) + '" height="' + (2 + r() * 6).toFixed(0) + '" fill="#fff" opacity="0"/>'; }
        break;
      case 'rain':
        for (var m = 0; m < 90; m++) inner += '<rect class="fx-drop" x="' + (r() * 2000 - 1000).toFixed(0) + '" y="' + (r() * 1200 - 700).toFixed(0) + '" width="3" height="' + (24 + r() * 30).toFixed(0) + '" fill="#bfdbfe" opacity=".6" transform="rotate(12)"/>';
        break;
      case 'hearts':
        for (var n = 0; n < (o.count || 8); n++) inner += '<g transform="translate(' + ((r() - 0.5) * 220).toFixed(0) + ' 0)"><path class="fx-p" d="M0 8 C-14 -8 -30 4 0 26 C30 4 14 -8 0 8 Z" fill="' + col + '" opacity="0"/></g>';
        break;
      case 'confetti':
        for (var p = 0; p < 60; p++) inner += '<rect class="fx-p" x="' + ((r() - 0.5) * 1600).toFixed(0) + '" y="' + (-600 - r() * 400).toFixed(0) + '" width="14" height="22" fill="' + ['#f43f5e', '#facc15', '#22c55e', '#3b82f6', '#a855f7'][p % 5] + '" transform="rotate(' + (r() * 360).toFixed(0) + ')"/>';
        break;
      case 'smoke':
        for (var q2 = 0; q2 < 12; q2++) inner += '<circle class="fx-puff" cx="' + ((r() - 0.5) * 300).toFixed(0) + '" cy="' + ((r() - 0.5) * 80).toFixed(0) + '" r="' + (50 + r() * 60).toFixed(0) + '" fill="#e5e7eb" opacity="0"/>';
        break;
      case 'light-rays':
        inner = '<g class="fx-rays">';
        for (var t = 0; t < 9; t++) inner += '<path class="fx-ray" d="M0 0 L' + (-200 + t * 50) + ' 1100 L' + (-160 + t * 50) + ' 1100 Z" fill="' + col + '" opacity="0"/>';
        inner += '</g>';
        break;
      case 'magic-trail':
        inner = '<path class="fx-trail" d="' + (o.d || 'M-400 100 C-200 -150 100 200 400 -60') + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>';
        break;
    }
    return '<g id="' + id + '" class="ck-fx" data-kind="' + kind + '" transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' + inner + '</g>';
  }

  /** Animate an effect placed with fx(). */
  function play(tl, sel, kind, at, o) {
    o = o || {};
    var S = sel, dur = o.dur || 1.5;
    switch (kind) {
      case 'portal-door':
        tl.to(S + ' .fx-glow', { opacity: 1, duration: 0.6 }, at);
        tl.to(S + ' .fx-door', { scaleX: 0.08, duration: 0.7, ease: 'power2.inOut', transformOrigin: '0% 50%' }, at + 0.4);
        tl.to(S + ' .fx-glow', { scale: 1.08, duration: 0.6, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.6)) - 1, transformOrigin: '50% 50%' }, at + 0.6);
        break;
      case 'sparkles':
      case 'hearts':
        tl.fromTo(S + ' .fx-p', { opacity: 0, scale: 0.2, y: 0 }, { opacity: 1, scale: 1, y: kind === 'hearts' ? -180 : 0, duration: dur * 0.4, stagger: { each: dur / 40, from: 'random' }, ease: 'back.out(2)', transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .fx-p', { opacity: 0, rotation: 90, duration: dur * 0.4, stagger: { each: dur / 50, from: 'random' }, transformOrigin: '50% 50%' }, at + dur * 0.55);
        break;
      case 'glow-aura':
        tl.to(S + ' .fx-glow', { opacity: 1, duration: 0.5 }, at);
        tl.to(S + ' .fx-glow', { scale: 1.12, duration: 0.35, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.35)) - 1, transformOrigin: '50% 50%' }, at + 0.5);
        tl.fromTo(S + ' .fx-flame', { opacity: 0, scaleY: 0.3 }, { opacity: 0.85, scaleY: 1, duration: 0.3, stagger: 0.03, transformOrigin: '50% 100%' }, at + 0.2);
        tl.to(S + ' .fx-flame', { scaleY: 0.7, duration: 0.18, yoyo: true, repeat: Math.max(1, Math.round(dur / 0.18)) - 1, stagger: { each: 0.02, from: 'random' }, transformOrigin: '50% 100%' }, at + 0.5);
        break;
      case 'energy-orb':
        tl.to(S + ' .fx-orb', { scale: 1, duration: dur * 0.6, ease: 'power2.in', transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .fx-ring', { rotation: 360 * Math.max(1, Math.round(dur)), duration: dur, ease: 'none', transformOrigin: '50% 50%' }, at);
        tl.to(S + ' .fx-orb', { scale: 1.15, duration: 0.12, yoyo: true, repeat: Math.max(1, Math.round((dur * 0.4) / 0.12)) - 1, transformOrigin: '50% 50%' }, at + dur * 0.6);
        break;
      case 'explosion':
        tl.fromTo(S + ' .fx-flash', { opacity: 1, scale: 0.2 }, { opacity: 0, scale: 8, duration: 0.5, ease: 'power2.out', transformOrigin: '50% 50%' }, at);
        tl.set(S + ' .fx-ray', { opacity: 1 }, at);
        tl.fromTo(S + ' .fx-rays', { opacity: 1, scale: 0 }, { opacity: 0, scale: 1.4, duration: 0.8, ease: 'expo.out', transformOrigin: '50% 50%' }, at);
        tl.fromTo(S + ' .fx-ring', { opacity: 1, scale: 0.2 }, { opacity: 0, scale: 6, duration: 0.7, ease: 'power2.out', transformOrigin: '50% 50%' }, at + 0.05);
        break;
      case 'speed-lines':
        tl.fromTo(S + ' .fx-line', { opacity: 0, x: 0 }, { opacity: 0.8, x: 1600, duration: 0.45, ease: 'none', stagger: { each: dur / 60, from: 'random', repeat: Math.max(0, Math.round(dur / 0.45) - 1) } }, at);
        break;
      case 'rain':
        tl.fromTo(S + ' .fx-drop', { y: 0 }, { y: 900, duration: 0.6, ease: 'none', stagger: { each: 0.01, repeat: Math.max(0, Math.round(dur / 0.6) - 1) } }, at);
        break;
      case 'confetti':
        tl.to(S + ' .fx-p', { y: '+=1400', rotation: '+=540', duration: dur, ease: 'power1.in', stagger: { each: dur / 120, from: 'random' }, transformOrigin: '50% 50%' }, at);
        break;
      case 'smoke':
        tl.fromTo(S + ' .fx-puff', { opacity: 0.9, scale: 0.4 }, { opacity: 0, scale: 2, y: -120, duration: dur, ease: 'power1.out', stagger: 0.05, transformOrigin: '50% 50%' }, at);
        break;
      case 'light-rays':
        tl.to(S + ' .fx-ray', { opacity: 0.35, duration: 0.6, stagger: 0.05 }, at);
        tl.to(S + ' .fx-ray', { opacity: 0.15, duration: 1, yoyo: true, repeat: Math.max(1, Math.round(dur / 1)) - 1, stagger: { each: 0.1, from: 'random' } }, at + 0.6);
        break;
      case 'magic-trail':
        tl.to(S + ' .fx-trail', { strokeDashoffset: 0, duration: dur, ease: 'power2.inOut' }, at);
        break;
    }
    return tl;
  }

  /** Camera: push in / pan / shake on a wrapper element. */
  function camera(tl, sel, move, at, o) {
    o = o || {};
    var dur = o.dur || 2;
    if (move === 'push') tl.fromTo(sel, { scale: o.from || 1 }, { scale: o.to || 1.15, duration: dur, ease: o.ease || 'sine.inOut', transformOrigin: o.origin || '50% 50%' }, at);
    else if (move === 'pan') tl.fromTo(sel, { x: o.fromX || 0 }, { x: o.toX == null ? -200 : o.toX, duration: dur, ease: o.ease || 'sine.inOut' }, at);
    else if (move === 'shake') tl.to(sel, { x: '+=14', y: '-=8', duration: 0.04, yoyo: true, repeat: Math.max(2, Math.round(dur / 0.04)) - 1, ease: 'none' }, at);
    else if (move === 'tilt') tl.fromTo(sel, { rotation: 0 }, { rotation: o.to || 3, duration: dur, ease: 'sine.inOut' }, at);
    return tl;
  }

  window.CartoonKit = { character: character, act: act, world: world, parallax: parallax, fx: fx, play: play, camera: camera, kinds: Object.keys(KINDS), emotions: Object.keys(EMO), worlds: ['bedroom', 'classroom', 'kitchen', 'street', 'park', 'city-night', 'sky', 'floating-islands', 'forest', 'mountains', 'beach', 'underwater', 'space', 'battlefield'], effects: ['portal-door', 'sparkles', 'glow-aura', 'energy-orb', 'explosion', 'speed-lines', 'rain', 'hearts', 'confetti', 'smoke', 'light-rays', 'magic-trail'] };
})();

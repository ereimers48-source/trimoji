// Emoji glide. A tapped emoji travels into the slot it fills.
// The shop calls play() after pick(); nothing runs on first load.

export const GLIDE_MS = 520;
export const HIDDEN_MS = 460;
export const FADE_MS = 240;

const GLIDE_OFFSETS = [0, 0.14, 0.32, 0.55, 0.78, 1];
const LAYER_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:25',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'pointer-events:none',
  'overflow:visible',
].join(';');

const TRANSFORM_RE = /^translate3d\(-?\d+(\.\d+)?px,-?\d+(\.\d+)?px,0\) scale\(\d+(\.\d+)?\)$/;

function round(n) {
  return Math.round(n * 100) / 100;
}

function easeOutCubic(t) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

function emptyPlan() {
  return {
    mode: 'none',
    slot: null,
    duration: 0,
    travel: null,
    incoming: null,
    outgoing: null,
    pop: null,
  };
}

function place(x, y, size, scale) {
  const tx = round(x - size / 2);
  const ty = round(y - size / 2);
  return `translate3d(${tx}px,${ty}px,0) scale(${round(scale)})`;
}

function travelOpacity(offset) {
  if (offset <= 0.14) return round(offset / 0.14);
  if (offset >= 0.78) return round(Math.max(0, (1 - offset) / 0.22));
  return 1;
}

function incomingOpacity(offset) {
  if (offset <= 0.62) return 0;
  return round(Math.min(1, (offset - 0.62) / 0.38));
}

function outgoingOpacity(offset) {
  if (offset >= 0.5) return 0;
  return round(1 - offset / 0.5);
}

function popKeyframes(peak) {
  return [
    { offset: 0, transform: 'scale(1)' },
    { offset: 0.42, transform: `scale(${round(peak)})` },
    { offset: 0.72, transform: 'scale(0.988)' },
    { offset: 1, transform: 'scale(1)' },
  ];
}

export function slotIsVisible(rect, limits, cover) {
  if (!rect || !(rect.width > 8) || !(rect.height > 8)) return false;
  const bounds = limits || { top: 0, bottom: 800, left: 0, right: 400 };
  const top = Math.max(rect.top, bounds.top);
  const bottom = Math.min(rect.bottom, bounds.bottom);
  const left = Math.max(rect.left, bounds.left);
  const right = Math.min(rect.right, bounds.right);
  if (bottom - top <= rect.height * 0.55 || right - left <= rect.width * 0.55) return false;
  if (cover && cover.height > 8 && cover.width > 8) {
    const overlap = Math.min(rect.bottom, cover.bottom) - Math.max(rect.top, cover.top);
    const across = Math.min(rect.right, cover.right) - Math.max(rect.left, cover.left);
    if (overlap > rect.height * 0.45 && across > rect.width * 0.45) return false;
  }
  return true;
}

export function planEmojiGlide({ reduced, slotVisible, fade, source, slot }) {
  if (!slot || !(slot.size > 1) || !Number.isFinite(slot.x) || !Number.isFinite(slot.y)) return emptyPlan();
  const sourceOk = !!(source && source.size > 1 && Number.isFinite(source.x) && Number.isFinite(source.y));
  const travelOn = !reduced && !!slotVisible && sourceOk;
  const mode = travelOn ? 'glide' : 'fade';
  const duration = reduced ? FADE_MS : (travelOn ? GLIDE_MS : HIDDEN_MS);
  const endScale = sourceOk ? Math.min(2.4, Math.max(0.35, slot.size / source.size)) : 1;
  let travel = null;
  if (travelOn) {
    const size = source.size;
    const keyframes = GLIDE_OFFSETS.map((offset) => {
      const u = easeOutCubic(offset);
      const frame = {
        offset,
        transform: place(
          source.x + (slot.x - source.x) * u,
          source.y + (slot.y - source.y) * u,
          size,
          1 + (endScale - 1) * u,
        ),
        opacity: travelOpacity(offset),
      };
      if (!TRANSFORM_RE.test(frame.transform)) frame.transform = place(source.x, source.y, size, 1);
      return frame;
    });
    travel = {
      duration,
      delay: 0,
      size: round(size),
      from: { x: round(source.x), y: round(source.y) },
      to: { x: round(slot.x), y: round(slot.y) },
      keyframes,
    };
  }
  const incoming = fade ? {
    duration,
    delay: 0,
    keyframes: reduced
      ? [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }]
      : GLIDE_OFFSETS.map((offset) => ({ offset, opacity: incomingOpacity(offset) })),
  } : null;
  const outgoing = fade ? {
    duration,
    delay: 0,
    keyframes: reduced
      ? [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }]
      : GLIDE_OFFSETS.map((offset) => ({ offset, opacity: outgoingOpacity(offset) })),
  } : null;
  const peak = 1.055;
  const popDuration = reduced ? 0 : Math.min(220, Math.round(duration * 0.42));
  const pop = reduced ? null : {
    duration: popDuration,
    delay: duration - popDuration,
    peak,
    keyframes: popKeyframes(peak),
  };
  return {
    mode,
    slot: null,
    duration,
    travel,
    incoming,
    outgoing,
    pop,
  };
}

function prefersReduced(win) {
  try {
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function centerOf(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    size: Math.max(rect.width, rect.height),
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function viewLimits(doc, win) {
  const height = win.innerHeight || 0;
  const width = win.innerWidth || 0;
  let top = 0;
  let bottom = height;
  const bar = doc.querySelector('.topbar');
  if (bar) {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0) top = Math.max(top, rect.bottom);
  }
  if (doc.documentElement && doc.documentElement.classList.contains('dock-on')) {
    const dock = doc.querySelector('#dock');
    if (dock) {
      const rect = dock.getBoundingClientRect();
      if (rect.height > 2 && rect.top < bottom) bottom = Math.min(bottom, rect.top);
    }
  }
  return { top, bottom, left: 0, right: width };
}

function stageCover(doc, win) {
  const stage = doc.querySelector('#stage');
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8 || rect.bottom <= 0 || rect.top >= (win.innerHeight || 0)) return null;
  let position = '';
  try { position = win.getComputedStyle(stage).position; } catch { position = ''; }
  if (position !== 'sticky' && position !== 'fixed') return null;
  return rect;
}

function pictureOf(el) {
  if (!el) return null;
  if (el.tagName === 'IMG') return el;
  return el.querySelector ? el.querySelector('img.em') : null;
}

function imageBox(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const img = pictureOf(el);
  const node = img || el;
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    if (el !== node) {
      const button = el.getBoundingClientRect();
      if (button.width >= 2 && button.height >= 2) return centerOf(button);
    }
    return null;
  }
  return centerOf(rect);
}

function findGridButton(doc, emoji) {
  if (!emoji) return null;
  const buttons = doc.querySelectorAll('#grid button[data-emoji]');
  for (const button of buttons) {
    if (button.dataset.emoji === emoji) return button;
  }
  return null;
}

function measure(doc, win, slotIndex, from, previous) {
  const chips = [...doc.querySelectorAll('#slots .slot')].slice(0, 3);
  const chip = chips[slotIndex] || null;
  const slotImg = chip ? chip.querySelector('img.em') : null;
  const slotBox = chip ? centerOf(chip.getBoundingClientRect()) : null;
  const glyph = slotImg ? imageBox(slotImg) : null;
  const target = glyph && glyph.size > 1 ? glyph : null;
  const emoji = slotImg ? (slotImg.alt || '') : '';
  const originEl = from && from.isConnected !== false ? from : findGridButton(doc, emoji);
  const originImg = pictureOf(originEl);
  const source = originEl ? imageBox(originEl) : null;
  const shown = slotImg ? (slotImg.currentSrc || slotImg.src || '') : '';
  const same = !!(previous && shown && previous === shown);
  const limits = viewLimits(doc, win);
  const cover = stageCover(doc, win);
  return {
    chip,
    slotImg,
    slotBox,
    target,
    source,
    emoji,
    same,
    replaces: !!(previous && !same),
    previous: previous || '',
    originImg,
    slotVisible: !!(slotBox && slotIsVisible(slotBox, limits, cover)),
    sourceVisible: !!(source && slotIsVisible(source, limits, null)),
  };
}

function injectStyle(doc) {
  if (doc.getElementById('emoji-glide-style')) return;
  const style = doc.createElement('style');
  style.id = 'emoji-glide-style';
  style.textContent = [
    '#emoji-glide{position:fixed;inset:0;z-index:25;margin:0;padding:0;border:0;background:transparent;pointer-events:none;overflow:visible}',
    '#emoji-glide .glyph,#emoji-glide .echo{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:transparent;pointer-events:none;transform-origin:center center;will-change:transform,opacity}',
    '@media (prefers-reduced-motion: reduce){#emoji-glide .glyph{display:none !important}}',
  ].join('');
  (doc.head || doc.documentElement).appendChild(style);
}

export function createEmojiGlide(doc, win) {
  let generation = 0;
  let timer = 0;
  let layer = null;
  let anims = [];
  let touched = [];
  const api = {
    lastPlan: null,
    play,
    cancel: stop,
    activeNodes() {
      return layer ? layer.childElementCount : 0;
    },
  };

  function restore() {
    const nodes = touched;
    touched = [];
    for (const el of nodes) {
      try { el.style.opacity = ''; } catch { /* detached */ }
    }
  }

  function finish(token) {
    if (token !== generation) return;
    if (timer) {
      win.clearTimeout(timer);
      timer = 0;
    }
    const running = anims;
    anims = [];
    for (const anim of running) {
      try { anim.cancel(); } catch { /* already finished */ }
    }
    restore();
    if (layer) {
      layer.remove();
      layer = null;
    }
  }

  function stop() {
    generation += 1;
    if (timer) {
      win.clearTimeout(timer);
      timer = 0;
    }
    const running = anims;
    anims = [];
    for (const anim of running) {
      try { anim.cancel(); } catch { /* already finished */ }
    }
    restore();
    if (layer) {
      layer.remove();
      layer = null;
    }
  }

  function track(anim) {
    if (anim) anims.push(anim);
    return anim;
  }

  function fade(el, frames, duration, token) {
    if (!el) return;
    touched.push(el);
    const first = frames[0];
    el.style.opacity = String(first && first.opacity != null ? first.opacity : 0);
    if (typeof el.animate !== 'function') return;
    const anim = track(el.animate(frames, { duration, easing: 'linear', fill: 'forwards' }));
    if (!anim) return;
    anim.onfinish = () => {
      if (token !== generation) return;
      try { anim.cancel(); } catch { /* finished */ }
      el.style.opacity = '';
    };
  }

  function mount(plan, measured, token) {
    const host = doc.createElement('div');
    host.id = 'emoji-glide';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = LAYER_STYLE;
    const source = measured.source;
    if (plan.travel && source) {
      const glyph = doc.createElement('img');
      glyph.className = 'glyph';
      glyph.alt = '';
      glyph.draggable = false;
      glyph.decoding = 'sync';
      glyph.setAttribute('aria-hidden', 'true');
      const first = plan.travel.keyframes[0];
      glyph.style.cssText = `position:absolute;left:0;top:0;width:${plan.travel.size}px;height:${plan.travel.size}px;opacity:0;pointer-events:none;transform-origin:center center;transform:${first.transform};will-change:transform,opacity`;
      const origin = measured.originImg;
      glyph.src = origin ? (origin.currentSrc || origin.src || '') : '';
      host.appendChild(glyph);
      if (typeof glyph.animate === 'function') {
        const anim = track(glyph.animate(plan.travel.keyframes, {
          duration: plan.travel.duration,
          delay: plan.travel.delay,
          easing: 'linear',
          fill: 'both',
        }));
        if (anim) anim.onfinish = () => { glyph.style.opacity = '0'; };
      }
    }
    if (plan.outgoing && measured.replaces && measured.previous && measured.target) {
      const echo = doc.createElement('img');
      echo.className = 'echo';
      echo.alt = '';
      echo.draggable = false;
      echo.decoding = 'sync';
      echo.setAttribute('aria-hidden', 'true');
      const spot = place(measured.target.x, measured.target.y, measured.target.size, 1);
      echo.style.cssText = `position:absolute;left:0;top:0;width:${round(measured.target.size)}px;height:${round(measured.target.size)}px;opacity:1;pointer-events:none;transform-origin:center center;transform:${spot};will-change:opacity`;
      echo.src = measured.previous;
      host.appendChild(echo);
      if (typeof echo.animate === 'function') {
        track(echo.animate(plan.outgoing.keyframes, {
          duration: plan.outgoing.duration,
          easing: 'linear',
          fill: 'forwards',
        }));
      }
    }
    if (!host.childElementCount) return;
    (doc.body || doc.documentElement).appendChild(host);
    layer = host;
    if (token !== generation) {
      host.remove();
      layer = null;
    }
  }

  function play(slotIndex, detail) {
    stop();
    const token = generation;
    injectStyle(doc);
    const options = detail || {};
    const index = Number(slotIndex);
    let measured;
    try {
      measured = measure(doc, win, index, options.from || null, options.previous || '');
    } catch {
      api.lastPlan = emptyPlan();
      return api.lastPlan;
    }
    const plan = planEmojiGlide({
      reduced: prefersReduced(win),
      slotVisible: measured.slotVisible && measured.sourceVisible,
      fade: !measured.same,
      source: measured.source,
      slot: measured.target,
    });
    plan.slot = Number.isInteger(index) ? index : null;
    api.lastPlan = plan;
    if (plan.mode === 'none') return plan;
    if (plan.incoming && measured.slotImg) fade(measured.slotImg, plan.incoming.keyframes, plan.incoming.duration, token);
    if (plan.pop && measured.chip && typeof measured.chip.animate === 'function') {
      track(measured.chip.animate(plan.pop.keyframes, {
        duration: plan.pop.duration,
        delay: plan.pop.delay,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'none',
      }));
    }
    if (plan.mode === 'glide' || (plan.outgoing && measured.replaces)) mount(plan, measured, token);
    timer = win.setTimeout(() => finish(token), Math.min(1200, plan.duration + 120));
    return plan;
  }

  return api;
}

if (typeof document !== 'undefined' && document.documentElement) {
  globalThis.TrimojiEmojiGlide = createEmojiGlide(document, globalThis);
}

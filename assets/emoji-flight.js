// Emoji-pick flight. Kept out of index.html so product work in the builder
// can land beside it. Plays only when the shop calls play() after a pick.

export const FLIGHT_MIN_MS = 600;
export const FLIGHT_MAX_MS = 900;

const OFFSETS = [0, 0.12, 0.28, 0.48, 0.68, 0.84, 1];
const LAYER_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:25',
  'margin:0',
  'padding:0',
  'border:0',
  'background:transparent',
  'pointer-events:none',
  'overflow:hidden',
].join(';');

const TRANSFORM_RE = /^translate3d\(-?\d+(\.\d+)?px,-?\d+(\.\d+)?px,0\) scale\(\d+(\.\d+)?\)$/;

export function assignTargets(filled, imagePoints) {
  const targets = [null, null, null];
  let cursor = 0;
  for (let index = 0; index < 3; index += 1) {
    if (!filled[index]) continue;
    targets[index] = imagePoints[cursor] || null;
    cursor += 1;
  }
  return targets;
}

export function arcPoint(t, from, control, to) {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}

export function aimPoint(from, to, viewport, pad = 28) {
  const maxX = Math.max(pad, (viewport.width || 0) - pad);
  const maxY = Math.max(pad, (viewport.height || 0) - pad);
  const minX = Math.min(pad, maxX);
  const minY = Math.min(pad, maxY);
  const inside = to.x >= minX - 36 && to.x <= maxX + 36 && to.y >= minY - 36 && to.y <= maxY + 36;
  if (inside) return { x: to.x, y: to.y, clipped: false };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t = 1;
  const consider = (edge, start, delta) => {
    if (!delta) return;
    const hit = (edge - start) / delta;
    if (hit >= 0 && hit < t) t = hit;
  };
  if (to.x < minX) consider(minX, from.x, dx);
  else if (to.x > maxX) consider(maxX, from.x, dx);
  if (to.y < minY) consider(minY, from.y, dy);
  else if (to.y > maxY) consider(maxY, from.y, dy);
  if (!(t > 0) || t >= 1) return { x: from.x, y: from.y, clipped: true };
  return { x: from.x + dx * t, y: from.y + dy * t, clipped: true };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function emptyPlan() {
  return { mode: 'none', changed: null, duration: 0, pops: [], flights: [] };
}

function trio(list) {
  const out = [null, null, null];
  if (!Array.isArray(list)) return out;
  for (let index = 0; index < 3; index += 1) out[index] = list[index] || null;
  return out;
}

function place(x, y, size, scale) {
  const tx = round(x - size / 2);
  const ty = round(y - size / 2);
  return `translate3d(${tx}px,${ty}px,0) scale(${round(scale)})`;
}

function flightOpacity(offset, clipped) {
  const fadeIn = Math.min(1, offset / 0.12);
  const fadeOutStart = clipped ? 0.48 : 0.62;
  const fadeOut = offset <= fadeOutStart ? 1 : 1 - (offset - fadeOutStart) / (1 - fadeOutStart);
  return round(Math.max(0, Math.min(1, fadeIn * fadeOut)));
}

function flightScale(offset, endScale, changed) {
  // The slot chip does the springy pop. The copy that leaves is already small,
  // a little larger than the print, then settles to the print size.
  const emerge = Math.min(
    changed ? 0.5 : 0.4,
    Math.max(endScale * (changed ? 1.28 : 1.1), changed ? 0.34 : 0.28),
  );
  const cruising = Math.max(endScale, emerge * 0.92);
  if (offset <= 0.18) {
    const u = offset / 0.18;
    return emerge + (cruising - emerge) * u;
  }
  const u = easeOutCubic((offset - 0.18) / 0.82);
  return Math.max(0.12, cruising + (endScale - cruising) * u);
}

function popKeyframes(peak, reduced) {
  if (reduced) {
    return [
      { offset: 0, transform: 'scale(0.96)', opacity: 0.7 },
      { offset: 1, transform: 'scale(1)', opacity: 1 },
    ];
  }
  return [
    { offset: 0, transform: 'scale(1)', opacity: 1, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.25)' },
    { offset: 0.38, transform: `scale(${round(peak)})`, opacity: 1, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
    { offset: 0.7, transform: 'scale(0.98)', opacity: 1 },
    { offset: 1, transform: 'scale(1)', opacity: 1 },
  ];
}

function controlFor(from, to, lift, biasX) {
  return {
    x: (from.x + to.x) / 2 + biasX,
    y: (from.y + to.y) / 2 - lift,
  };
}

export function planEmojiFlight({ changed, reduced, viewport, slots, targets }) {
  const slotList = trio(slots);
  const targetList = trio(targets);
  const filled = [];
  for (let index = 0; index < 3; index += 1) {
    const slot = slotList[index];
    if (slot && slot.size > 1 && Number.isFinite(slot.x) && Number.isFinite(slot.y)) filled.push(index);
  }
  if (!filled.length) return emptyPlan();

  const changedIndex = filled.includes(Number(changed)) ? Number(changed) : filled[filled.length - 1];
  const box = viewport && viewport.width > 0 && viewport.height > 0
    ? viewport
    : { width: 390, height: 844 };
  const pops = [];
  const flights = [];

  for (const index of filled) {
    const isChanged = index === changedIndex;
    const peak = reduced ? 1.04 : (isChanged ? 1.22 : 1.08);
    const popDelay = reduced || isChanged ? 0 : 20;
    const popDuration = reduced ? 200 : (isChanged ? 680 : 620);
    pops.push({
      index,
      changed: isChanged,
      delay: popDelay,
      duration: popDuration,
      peak,
      keyframes: popKeyframes(peak, reduced),
    });
    if (reduced) continue;

    const slot = slotList[index];
    const rawTarget = targetList[index];
    const target = rawTarget && Number.isFinite(rawTarget.x) && Number.isFinite(rawTarget.y)
      ? rawTarget
      : { x: slot.x, y: Math.max(36, slot.y - 96), size: slot.size * 0.45 };
    const aim = aimPoint(slot, target, box);
    const distance = Math.hypot(aim.x - slot.x, aim.y - slot.y);
    const lift = Math.min(68, (isChanged ? 46 : 26) + distance * 0.035);
    const biasX = (index - 1) * 14;
    const control = controlFor(slot, aim, lift, biasX);
    const ratio = aim.clipped ? 0.42 : (target.size > 1 ? target.size / slot.size : 0.4);
    const endScale = Math.min(1.15, Math.max(0.16, ratio));
    const distanceSlots = Math.abs(index - changedIndex);
    const delay = isChanged ? 0 : 32 + distanceSlots * 24;
    const duration = isChanged ? 860 : 760;
    const size = slot.size;
    const keyframes = OFFSETS.map((offset) => {
      const point = arcPoint(easeOutCubic(offset), slot, control, aim);
      const frame = {
        offset,
        transform: place(point.x, point.y, size, flightScale(offset, endScale, isChanged)),
        opacity: flightOpacity(offset, aim.clipped),
      };
      if (!TRANSFORM_RE.test(frame.transform)) {
        frame.transform = place(point.x, point.y, size, 1);
      }
      return frame;
    });
    flights.push({
      index,
      changed: isChanged,
      delay,
      duration,
      size: round(size),
      from: { x: round(slot.x), y: round(slot.y) },
      to: { x: round(aim.x), y: round(aim.y) },
      clipped: aim.clipped,
      keyframes,
    });
  }

  const ends = [
    ...pops.map((pop) => pop.delay + pop.duration),
    ...flights.map((flight) => flight.delay + flight.duration),
  ];
  return {
    mode: reduced ? 'reduced' : 'full',
    changed: changedIndex,
    duration: ends.length ? Math.max(...ends) : 0,
    pops,
    flights,
  };
}

function prefersReduced(win) {
  try {
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function viewportOf(win) {
  const visual = win.visualViewport;
  return {
    width: visual && visual.width ? visual.width : win.innerWidth,
    height: visual && visual.height ? visual.height : win.innerHeight,
  };
}

function centerOf(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    size: Math.max(rect.width, rect.height),
  };
}

function svgImageCenter(image, svg) {
  const x = Number(image.getAttribute('x'));
  const y = Number(image.getAttribute('y'));
  const w = Number(image.getAttribute('width'));
  const h = Number(image.getAttribute('height')) || w;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0)) return null;
  // Kiss-cut tiles sit in translated <g> groups. Screen CTM includes that
  // translation; viewBox math alone would drop every copy on the first tile's local box.
  try {
    const ctm = typeof image.getScreenCTM === 'function' ? image.getScreenCTM() : null;
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const mid = svg.createSVGPoint();
      mid.x = x + w / 2;
      mid.y = y + h / 2;
      const center = mid.matrixTransform(ctm);
      const edge = svg.createSVGPoint();
      edge.x = x + w;
      edge.y = y + h / 2;
      const end = edge.matrixTransform(ctm);
      const size = Math.hypot(end.x - center.x, end.y - center.y) * 2;
      if (Number.isFinite(center.x) && Number.isFinite(center.y) && size > 1) {
        return { x: center.x, y: center.y, size };
      }
    }
  } catch { /* fall through to viewBox mapping */ }
  const box = svg.getBoundingClientRect();
  const view = svg.viewBox && svg.viewBox.baseVal;
  if (!view || !view.width || !view.height || box.width < 2 || box.height < 2) return null;
  const scale = Math.min(box.width / view.width, box.height / view.height);
  const padX = (box.width - view.width * scale) / 2;
  const padY = (box.height - view.height * scale) / 2;
  const left = box.left + padX + (x - view.x) * scale;
  const top = box.top + padY + (y - view.y) * scale;
  return { x: left + (w * scale) / 2, y: top + (h * scale) / 2, size: Math.max(w, h) * scale };
}

function measure(doc, win) {
  const chips = [...doc.querySelectorAll('#slots .slot')].slice(0, 3);
  const slots = [0, 1, 2].map((index) => {
    const chip = chips[index];
    if (!chip) return null;
    const img = chip.querySelector('img.em');
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { img, ...centerOf(rect) };
  });
  const print = doc.querySelector('#mock .print');
  let images = print ? [...print.querySelectorAll('image')] : [];
  if (!images.length && print) images = [...print.querySelectorAll('img')];
  const flags = slots.map((slot) => !!(slot && slot.size > 1));
  // A sticker sheet repeats the trio on every tile. The first filled images
  // are the top-left sticker, so the copies settle there instead of scattering.
  const needed = flags.filter(Boolean).length;
  if (needed > 0 && images.length > needed) images = images.slice(0, needed);
  const points = [];
  for (const image of images) {
    const rect = image.getBoundingClientRect();
    if (rect.width >= 2 && rect.height >= 2) {
      points.push(centerOf(rect));
      continue;
    }
    const svg = image.ownerSVGElement || (print && print.querySelector('svg'));
    const mapped = svg ? svgImageCenter(image, svg) : null;
    if (mapped) points.push(mapped);
  }
  const targets = assignTargets(flags, points);
  if (print) {
    const printBox = print.getBoundingClientRect();
    if (printBox.width > 2 && printBox.height > 2) {
      const fallback = centerOf(printBox);
      const glyph = Math.min(Math.max(printBox.width, printBox.height) * 0.18, 56);
      for (let index = 0; index < 3; index += 1) {
        if (flags[index] && !targets[index]) targets[index] = { x: fallback.x, y: fallback.y, size: glyph };
      }
    }
  }
  return {
    viewport: viewportOf(win),
    slots: slots.map((slot) => (slot ? { x: slot.x, y: slot.y, size: slot.size } : null)),
    targets,
    imgs: slots.map((slot) => (slot ? slot.img : null)),
  };
}

function injectStyle(doc) {
  if (doc.getElementById('emoji-flight-style')) return;
  const style = doc.createElement('style');
  style.id = 'emoji-flight-style';
  style.textContent = [
    '#emoji-flight{position:fixed;inset:0;z-index:25;margin:0;padding:0;border:0;background:transparent;pointer-events:none;overflow:hidden}',
    '#emoji-flight .glyph{position:absolute;left:0;top:0;margin:0;padding:0;border:0;background:transparent;opacity:0;pointer-events:none;transform-origin:center center;will-change:transform,opacity}',
    '@media (prefers-reduced-motion: reduce){#emoji-flight{display:none !important}}',
  ].join('');
  (doc.head || doc.documentElement).appendChild(style);
}

export function createEmojiFlight(doc, win) {
  let generation = 0;
  let timer = 0;
  let layer = null;
  let anims = [];
  const api = {
    lastPlan: null,
    play,
    cancel: stop,
    activeNodes() {
      return layer ? layer.childElementCount : 0;
    },
  };

  function finish(token) {
    if (token !== generation) return;
    if (timer) {
      win.clearTimeout(timer);
      timer = 0;
    }
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
    if (layer) {
      layer.remove();
      layer = null;
    }
  }

  function mount(plan, measured, token) {
    const host = doc.createElement('div');
    host.id = 'emoji-flight';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = LAYER_STYLE;
    let pending = 0;
    for (const flight of plan.flights) {
      const source = measured.imgs[flight.index];
      const glyph = doc.createElement('img');
      glyph.className = 'glyph';
      glyph.alt = '';
      glyph.draggable = false;
      glyph.decoding = 'sync';
      glyph.setAttribute('aria-hidden', 'true');
      if (flight.changed) glyph.dataset.changed = 'true';
      const first = flight.keyframes[0];
      glyph.style.cssText = `position:absolute;left:0;top:0;width:${flight.size}px;height:${flight.size}px;opacity:0;pointer-events:none;transform-origin:center center;transform:${first.transform};will-change:transform,opacity`;
      if (source) glyph.src = source.currentSrc || source.src || '';
      host.appendChild(glyph);
      if (typeof glyph.animate !== 'function') continue;
      const anim = glyph.animate(flight.keyframes, {
        duration: flight.duration,
        delay: flight.delay,
        easing: 'linear',
        fill: 'both',
      });
      anims.push(anim);
      pending += 1;
      anim.onfinish = () => {
        pending -= 1;
        if (pending <= 0) finish(token);
      };
    }
    if (!host.childElementCount) return;
    doc.body.appendChild(host);
    layer = host;
    timer = win.setTimeout(() => finish(token), Math.min(1000, plan.duration + 80));
  }

  function play(changed) {
    stop();
    const token = generation;
    injectStyle(doc);
    let measured;
    try {
      measured = measure(doc, win);
    } catch {
      api.lastPlan = emptyPlan();
      return api.lastPlan;
    }
    const plan = planEmojiFlight({
      changed,
      reduced: prefersReduced(win),
      viewport: measured.viewport,
      slots: measured.slots,
      targets: measured.targets,
    });
    api.lastPlan = plan;
    if (plan.mode === 'none') return plan;
    for (const pop of plan.pops) {
      const img = measured.imgs[pop.index];
      if (!img || typeof img.animate !== 'function') continue;
      const anim = img.animate(pop.keyframes, {
        duration: pop.duration,
        delay: pop.delay,
        easing: 'linear',
        fill: 'none',
      });
      anims.push(anim);
    }
    if (plan.mode === 'full') mount(plan, measured, token);
    return plan;
  }

  return api;
}

if (typeof document !== 'undefined' && document.documentElement) {
  globalThis.TrimojiEmojiFlight = createEmojiFlight(document, globalThis);
}

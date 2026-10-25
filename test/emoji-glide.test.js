import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FADE_MS, GLIDE_MS, HIDDEN_MS, planEmojiGlide, slotIsVisible } from '../assets/emoji-glide.js';

const TRANSFORM = /^translate3d\(-?\d+(\.\d+)?px,-?\d+(\.\d+)?px,0\) scale\(\d+(\.\d+)?\)$/;

function glidePlan() {
  return planEmojiGlide({
    reduced: false,
    slotVisible: true,
    fade: true,
    source: { x: 180, y: 640, size: 28 },
    slot: { x: 70, y: 150, size: 56 },
  });
}

function center(frame, size) {
  const match = /translate3d\(([-\d.]+)px,([-\d.]+)px/.exec(frame.transform);
  return { x: Number(match[1]) + size / 2, y: Number(match[2]) + size / 2 };
}

test('a visible pick glides from the tapped emoji into its slot', () => {
  const plan = glidePlan();
  assert.equal(plan.mode, 'glide');
  assert.equal(plan.duration, GLIDE_MS);
  assert.ok(plan.duration >= 400 && plan.duration <= 600);
  assert.ok(plan.travel);
  assert.equal(plan.travel.keyframes.length > 2, true);
  assert.equal(plan.travel.keyframes[0].opacity, 0);
  assert.equal(plan.travel.keyframes.at(-1).opacity, 0);
  assert.equal(plan.travel.keyframes.find((frame) => frame.offset === 0.32).opacity, 1);
  const size = plan.travel.size;
  const start = center(plan.travel.keyframes[0], size);
  const end = center(plan.travel.keyframes.at(-1), size);
  const mid = center(plan.travel.keyframes.find((frame) => frame.offset === 0.32), size);
  assert.ok(Math.abs(start.x - 180) < 1.5 && Math.abs(start.y - 640) < 1.5);
  assert.ok(Math.abs(end.x - 70) < 1.5 && Math.abs(end.y - 150) < 1.5);
  assert.ok(mid.y < start.y - 80);
  assert.ok(mid.y > end.y);
  for (const frame of plan.travel.keyframes) {
    assert.match(frame.transform, TRANSFORM);
    assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
    assert.deepEqual(Object.keys(frame).sort(), ['offset', 'opacity', 'transform']);
  }
  assert.equal(plan.incoming.keyframes[0].opacity, 0);
  assert.equal(plan.incoming.keyframes.at(-1).opacity, 1);
  assert.equal(plan.outgoing.keyframes[0].opacity, 1);
  assert.equal(plan.outgoing.keyframes.at(-1).opacity, 0);
  assert.ok(plan.pop.peak > 1.03 && plan.pop.peak < 1.08);
  assert.equal(plan.pop.delay + plan.pop.duration, plan.duration);
  assert.deepEqual(Object.keys(plan.pop.keyframes[0]).sort(), ['offset', 'transform']);
});

test('a slot that is off screen fades in place and does not travel', () => {
  const plan = planEmojiGlide({
    reduced: false,
    slotVisible: false,
    fade: true,
    source: { x: 180, y: 700, size: 28 },
    slot: { x: 70, y: -40, size: 56 },
  });
  assert.equal(plan.mode, 'fade');
  assert.equal(plan.travel, null);
  assert.equal(plan.duration, HIDDEN_MS);
  assert.ok(plan.duration >= 400 && plan.duration <= 600);
  assert.ok(plan.pop);
  assert.equal(plan.incoming.keyframes[0].opacity, 0);
  assert.equal(plan.incoming.keyframes.at(-1).opacity, 1);
});

test('reduced motion is a cross-fade with no travel and no pop', () => {
  const plan = planEmojiGlide({
    reduced: true,
    slotVisible: true,
    fade: true,
    source: { x: 40, y: 500, size: 28 },
    slot: { x: 40, y: 120, size: 48 },
  });
  assert.equal(plan.mode, 'fade');
  assert.equal(plan.travel, null);
  assert.equal(plan.pop, null);
  assert.equal(plan.duration, FADE_MS);
  assert.ok(plan.duration <= 300);
  assert.deepEqual(plan.incoming.keyframes.map((frame) => frame.opacity), [0, 1]);
  assert.deepEqual(plan.outgoing.keyframes.map((frame) => frame.opacity), [1, 0]);
  for (const frame of [...plan.incoming.keyframes, ...plan.outgoing.keyframes]) {
    assert.equal(frame.transform, undefined);
  }
});

test('picking the same emoji does not plan a cross-fade', () => {
  const plan = planEmojiGlide({
    reduced: false,
    slotVisible: true,
    fade: false,
    source: { x: 80, y: 400, size: 28 },
    slot: { x: 80, y: 120, size: 48 },
  });
  assert.equal(plan.mode, 'glide');
  assert.equal(plan.incoming, null);
  assert.equal(plan.outgoing, null);
  assert.ok(plan.travel);
  assert.ok(plan.pop);
});

test('a missing slot does not plan an animation', () => {
  const plan = planEmojiGlide({
    reduced: false,
    slotVisible: true,
    fade: true,
    source: { x: 10, y: 10, size: 28 },
    slot: null,
  });
  assert.equal(plan.mode, 'none');
  assert.equal(plan.duration, 0);
  assert.equal(plan.travel, null);
  assert.equal(plan.pop, null);
});

test('planning does not mutate the measured points', () => {
  const source = { x: 12, y: 400, size: 28 };
  const slot = { x: 80, y: 90, size: 40 };
  const before = structuredClone({ source, slot });
  planEmojiGlide({ reduced: false, slotVisible: true, fade: true, source, slot });
  assert.deepEqual({ source, slot }, before);
});

test('slot visibility ignores a box that has scrolled away or sits under the preview', () => {
  const limits = { top: 88, bottom: 760, left: 0, right: 390 };
  assert.equal(slotIsVisible({
    top: -120, bottom: -40, left: 20, right: 100, width: 80, height: 80,
  }, limits, null), false);
  assert.equal(slotIsVisible({
    top: 96, bottom: 168, left: 16, right: 200, width: 184, height: 72,
  }, limits, null), true);
  assert.equal(slotIsVisible({
    top: 200, bottom: 280, left: 16, right: 100, width: 84, height: 80,
  }, limits, {
    top: 180, bottom: 520, left: 0, right: 390, width: 390, height: 340,
  }), false);
});

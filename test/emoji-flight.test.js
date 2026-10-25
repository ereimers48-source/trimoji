import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aimPoint, arcPoint, assignTargets, planEmojiFlight } from '../assets/emoji-flight.js';

const TRANSFORM = /^translate3d\(-?\d+(\.\d+)?px,-?\d+(\.\d+)?px,0\) scale\(\d+(\.\d+)?\)$/;

function samplePlan(changed = 1) {
  return planEmojiFlight({
    changed,
    reduced: false,
    viewport: { width: 400, height: 800 },
    slots: [
      { x: 60, y: 500, size: 40 },
      { x: 160, y: 500, size: 40 },
      { x: 260, y: 500, size: 40 },
    ],
    targets: [
      { x: 80, y: 180, size: 18 },
      { x: 160, y: 180, size: 18 },
      { x: 240, y: 180, size: 18 },
    ],
  });
}

function pointOf(transform) {
  const match = /translate3d\(([-\d.]+)px,([-\d.]+)px/.exec(transform);
  return { x: Number(match[1]), y: Number(match[2]) };
}

test('assignTargets keeps print images aligned with filled slots', () => {
  const targets = assignTargets([true, false, true], [
    { x: 1, y: 2, size: 3 },
    { x: 4, y: 5, size: 6 },
  ]);
  assert.deepEqual(targets, [
    { x: 1, y: 2, size: 3 },
    null,
    { x: 4, y: 5, size: 6 },
  ]);
});

test('a pick launches the three emojis inside 600–900ms and pops the new one hardest', () => {
  const plan = samplePlan(1);
  assert.equal(plan.mode, 'full');
  assert.equal(plan.changed, 1);
  assert.equal(plan.flights.length, 3);
  assert.equal(plan.pops.length, 3);
  assert.ok(plan.duration >= 600 && plan.duration <= 900);
  const changed = plan.pops.find((pop) => pop.changed);
  const other = plan.pops.find((pop) => !pop.changed);
  assert.ok(changed.peak > other.peak + 0.08);
  assert.equal(changed.delay, 0);
  for (const flight of plan.flights) {
    assert.ok(flight.duration >= 600 && flight.duration <= 900);
    assert.ok(flight.delay + flight.duration <= 900);
    assert.equal(flight.keyframes[0].opacity, 0);
    assert.equal(flight.keyframes.at(-1).opacity, 0);
    assert.equal(flight.keyframes.find((frame) => frame.offset === 0.48).opacity, 1);
    for (const frame of flight.keyframes) {
      assert.match(frame.transform, TRANSFORM);
      assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
      for (const key of Object.keys(frame)) {
        assert.ok(['offset', 'transform', 'opacity', 'easing'].includes(key));
      }
    }
  }
  const lead = plan.flights.find((flight) => flight.changed);
  const follow = plan.flights.find((flight) => !flight.changed);
  const leadMid = pointOf(lead.keyframes.find((frame) => frame.offset === 0.48).transform);
  const followMid = pointOf(follow.keyframes.find((frame) => frame.offset === 0.48).transform);
  assert.ok(leadMid.y < followMid.y);
});

test('the arc rises between the slot and the print', () => {
  const from = { x: 80, y: 520 };
  const to = { x: 200, y: 160 };
  const control = { x: 140, y: 280 };
  const mid = arcPoint(0.5, from, control, to);
  const straight = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  assert.ok(mid.y < straight.y - 8);
});

test('off-screen landings stop at the viewport edge', () => {
  const aim = aimPoint({ x: 180, y: 120 }, { x: 180, y: 2400 }, { width: 390, height: 700 });
  assert.equal(aim.clipped, true);
  assert.ok(aim.y < 700);
  assert.ok(aim.y > 120);
  const near = aimPoint({ x: 180, y: 200 }, { x: 200, y: 280 }, { width: 390, height: 700 });
  assert.equal(near.clipped, false);
  assert.equal(near.y, 280);
});

test('a far print is clipped and fades before it would streak off screen', () => {
  const plan = planEmojiFlight({
    changed: 0,
    reduced: false,
    viewport: { width: 390, height: 700 },
    slots: [{ x: 180, y: 120, size: 48 }, null, null],
    targets: [{ x: 180, y: 2400, size: 24 }, null, null],
  });
  assert.equal(plan.flights.length, 1);
  assert.equal(plan.flights[0].clipped, true);
  assert.ok(plan.flights[0].to.y < 700);
  const late = plan.flights[0].keyframes.find((frame) => frame.offset === 0.84);
  assert.ok(late.opacity < 0.5);
});

test('reduced motion is a short fade and scale with no flying copies', () => {
  const plan = planEmojiFlight({
    changed: 0,
    reduced: true,
    viewport: { width: 390, height: 844 },
    slots: [
      { x: 40, y: 200, size: 36 },
      { x: 90, y: 200, size: 36 },
      null,
    ],
    targets: [
      { x: 40, y: 80, size: 16 },
      { x: 90, y: 80, size: 16 },
      null,
    ],
  });
  assert.equal(plan.mode, 'reduced');
  assert.equal(plan.flights.length, 0);
  assert.equal(plan.pops.length, 2);
  assert.ok(plan.duration > 0 && plan.duration <= 300);
  assert.ok(plan.pops.every((pop) => pop.keyframes[0].opacity < 1 && pop.keyframes.at(-1).transform === 'scale(1)'));
});

test('an empty trio does not plan an animation', () => {
  const plan = planEmojiFlight({
    changed: 0,
    reduced: false,
    viewport: { width: 390, height: 844 },
    slots: [null, null, null],
    targets: [null, null, null],
  });
  assert.equal(plan.mode, 'none');
  assert.equal(plan.duration, 0);
  assert.deepEqual(plan.flights, []);
});

test('planning does not mutate the measured slots', () => {
  const slots = [{ x: 10, y: 20, size: 30 }, null, { x: 40, y: 50, size: 30 }];
  const before = structuredClone(slots);
  planEmojiFlight({
    changed: 2,
    reduced: false,
    viewport: { width: 390, height: 800 },
    slots,
    targets: [null, null, { x: 40, y: 10, size: 12 }],
  });
  assert.deepEqual(slots, before);
});

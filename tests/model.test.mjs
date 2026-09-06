import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STEPS,
  DEFAULT,
  Experiment,
  entropyTable,
  binomial,
  transition,
  validate,
  encode,
  decode,
  toCSV,
} from "../.test-build/model.js";
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("log multiplicities are symmetric, zero at endpoints, and maximal at balance", () => {
  for (const n of [20, 21, 100, 299, 300]) {
    const values = entropyTable(n);
    assert.equal(values[0], 0);
    assert.equal(values[n], 0);
    for (let k = 0; k <= n; k++) {
      close(values[k], values[n - k]);
      assert.ok(values[k] >= 0);
      assert.ok(values[k] <= values[Math.floor(n / 2)] + 1e-9);
    }
  }
  close(entropyTable(20)[1], Math.log2(20));
});
test("binomial probabilities normalize and satisfy lazy detailed balance", () => {
  for (const n of [20, 101, 300]) {
    const pi = binomial(n);
    close(
      pi.reduce((a, b) => a + b, 0),
      1,
    );
    for (let k = 0; k <= n; k++) {
      assert.ok(pi[k] > 0);
      close(pi[k], pi[n - k]);
      const p = transition(n, k);
      close(p.up + p.down + p.stay, 1);
      assert.equal(p.stay, 0.5);
      if (k < n) {
        const lhs = pi[k] * p.up,
          rhs = pi[k + 1] * transition(n, k + 1).down;
        assert.ok(Math.abs(lhs - rhs) / Math.max(lhs, rhs) < 1e-10);
      }
    }
  }
});
test("particle conservation, one selected label, and allowed macro transitions", () => {
  const e = new Experiment(DEFAULT);
  for (let step = 0; step < MAX_STEPS; step++) {
    const old = e.state;
    e.forward();
    const next = e.state;
    assert.equal(next.particles.length, 100);
    assert.equal(
      next.particles.reduce((a, b) => a + b, 0),
      e.left,
    );
    assert.equal(e.left + (100 - e.left), 100);
    const changed = next.particles.filter(
      (v, i) => v !== old.particles[i],
    ).length;
    assert.equal(changed, e.event.flip ? 1 : 0);
    assert.ok(Math.abs(e.left - old.left) <= 1);
    assert.ok(e.event.particle >= 0 && e.event.particle < 100);
  }
});
test("same seed yields the exact same event sequence", () => {
  const a = new Experiment(DEFAULT),
    b = new Experiment(DEFAULT);
  for (let i = 0; i < 400; i++) {
    a.forward();
    b.forward();
    assert.deepEqual(a.event, b.event);
    assert.deepEqual(a.state, b.state);
  }
  const other = new Experiment({ ...DEFAULT, seed: 43 });
  const original = new Experiment(DEFAULT);
  other.forward();
  original.forward();
  assert.notDeepEqual(other.event, original.event);
});
test("undo and replay restore microscopic state, RNG, and future events exactly", () => {
  const e = new Experiment({ ...DEFAULT, n: 21, initial: "balanced" });
  const initial = e.state;
  const states = [];
  for (let i = 0; i < 180; i++) {
    e.forward();
    states.push(e.state);
  }
  for (let i = 179; i >= 0; i--) {
    assert.deepEqual(e.state, states[i]);
    e.back();
  }
  assert.deepEqual(e.state, initial);
  assert.equal(e.recorded, 180);
  for (let i = 0; i < 180; i++) {
    e.forward();
    assert.deepEqual(e.state, states[i]);
  }
  const fresh = new Experiment({ ...DEFAULT, n: 21, initial: "balanced" });
  for (let i = 0; i < 181; i++) fresh.forward();
  e.forward();
  assert.deepEqual(e.state, fresh.state);
});
test("histogram and CSV count only the current replay prefix without duplication", () => {
  const e = new Experiment(DEFAULT);
  for (let i = 0; i < 50; i++) e.forward();
  assert.equal(
    e.histogram().reduce((a, b) => a + b, 0),
    51,
  );
  e.seek(20);
  assert.equal(e.points().length, 21);
  assert.equal(
    e.histogram().reduce((a, b) => a + b, 0),
    21,
  );
  const csv = toCSV(e);
  assert.equal(csv.trim().split("\r\n").length, 22);
  e.seek(0);
  e.seek(20);
  assert.equal(toCSV(e), csv);
  assert.equal(e.recorded, 50);
});
test("hard cap stops new events but keeps backward and forward replay available", () => {
  const e = new Experiment(DEFAULT);
  for (let i = 0; i < MAX_STEPS + 100; i++) e.forward();
  assert.equal(e.step, MAX_STEPS);
  assert.equal(e.recorded, MAX_STEPS);
  assert.equal(e.canForward, false);
  const last = e.state;
  assert.equal(e.forward(), false);
  assert.deepEqual(e.state, last);
  e.back();
  assert.equal(e.canForward, true);
  e.forward();
  assert.deepEqual(e.state, last);
});
test("a balanced model can decrease entropy and lazy events can leave it unchanged", () => {
  const e = new Experiment({ ...DEFAULT, initial: "balanced" });
  let lower = false,
    stay = false;
  for (let i = 0; i < 300; i++) {
    const before = e.entropy;
    e.forward();
    lower ||= e.entropy < before;
    stay ||= !e.event.flip;
  }
  assert.equal(lower, true);
  assert.equal(stay, true);
});
test("settings links round-trip and reject invalid, noncanonical or unknown settings", () => {
  for (const n of [20, 21, 300])
    for (const initial of ["left", "balanced"]) {
      const s = { n, initial, seed: 4294967295 };
      assert.deepEqual(decode(encode(s)), s);
    }
  for (const text of [
    "",
    "#v1.19.42.left",
    "#v1.300.4294967296.left",
    "#v1.100.042.left",
    "#v1.100.42.right",
    "#v1.100.42.left.extra",
  ])
    assert.equal(decode(text), null);
  for (const s of [
    { ...DEFAULT, n: 0 },
    { ...DEFAULT, n: 20.5 },
    { ...DEFAULT, seed: NaN },
    { ...DEFAULT, initial: "other" },
    { ...DEFAULT, extra: true },
  ]) {
    assert.equal(validate(s), false);
    assert.throws(() => new Experiment(s));
  }
  const e = new Experiment(DEFAULT);
  assert.equal(e.back(), false);
  assert.throws(() => e.seek(1));
  assert.throws(() => transition(100, -1));
});

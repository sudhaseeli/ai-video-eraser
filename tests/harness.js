// A tiny test harness that runs unchanged in the browser and in Node.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function near(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || 'value'}: expected ${b} ± ${tol}, got ${a}`);
}

export async function run(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    const start = Date.now();
    try {
      await t.fn();
      passed++;
      log(`✓ ${t.name} (${Date.now() - start} ms)`, true);
    } catch (e) {
      failed++;
      log(`✗ ${t.name}: ${e && e.message ? e.message : e}`, false);
    }
  }
  log(`\n${passed} passed, ${failed} failed`, failed === 0);
  return { passed, failed };
}

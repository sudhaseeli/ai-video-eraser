// Node runner (used by CI): node tests/run.mjs
import './core.test.js';
import { run } from './harness.js';

const { failed } = await run((line) => console.log(line));
process.exit(failed ? 1 : 0);

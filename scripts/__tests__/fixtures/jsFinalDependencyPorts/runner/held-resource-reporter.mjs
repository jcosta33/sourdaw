import assert from 'node:assert/strict';
import { HangingProcessReporter } from 'vitest/node';
const reporter = new HangingProcessReporter();
await reporter.onInit();
const uniqueTimer = setInterval(() => {}, 60_000);
const lines = [];
const original = console.error;
try {
    console.error = (...args) => lines.push(args.join(' '));
    reporter.onProcessTimeout();
} finally {
    console.error = original;
    clearInterval(uniqueTimer);
}
assert.match(lines.join('\n'), /# Timeout/);
assert.match(lines.join('\n'), /held-resource-reporter\.mjs/);
console.log('actual Vitest HangingProcessReporter printed live Timeout with source stack; timer cleared');

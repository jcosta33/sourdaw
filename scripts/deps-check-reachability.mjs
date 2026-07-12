#!/usr/bin/env node
/**
 * Full-edge reachability gate.
 *
 * dependency-cruiser's --ignore-known softens reachability by (from + rule name)
 * only, which swallows new targets under baselined components and never flags
 * stale baseline rows. This script instead:
 *   1. runs the reachability cruise to JSON
 *   2. extracts compact violation keys: from|to|rule
 *   3. compares against .dependency-cruiser-known-violations-reachability.json
 *   4. fails on NEW edges or STALE baseline entries (cleaned components must drop out)
 *
 * Usage:
 *   node scripts/deps-check-reachability.mjs
 *   node scripts/deps-check-reachability.mjs --write-baseline
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, '.dependency-cruiser-known-violations-reachability.json');
const configPath = resolve(root, '.dependency-cruiser.reachability.cjs');
const writeBaseline = process.argv.includes('--write-baseline');

function keyOf(row) {
    const rule = typeof row.rule === 'string' ? row.rule : row.rule?.name;
    return `${row.from}\0${row.to}\0${rule}`;
}

function compact(row) {
    const ruleName = typeof row.rule === 'string' ? row.rule : row.rule?.name;
    const severity = typeof row.rule === 'object' ? row.rule?.severity : 'error';
    return {
        type: row.type ?? 'reachability',
        from: row.from,
        to: row.to,
        rule: { severity: severity ?? 'error', name: ruleName },
    };
}

function loadBaseline() {
    if (!existsSync(baselinePath)) {
        return [];
    }
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function depcruiseBin() {
    const local = resolve(root, 'node_modules/.bin/depcruise');
    if (existsSync(local)) {
        return local;
    }
    return 'depcruise';
}

function runCruise() {
    const result = spawnSync(
        depcruiseBin(),
        [
            'src',
            '--config',
            configPath,
            '--output-type',
            'json',
            '--no-cache',
        ],
        {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: '0' },
            shell: false,
        }
    );
    // depcruise exits 1 when violations exist; still parse stdout JSON
    const stdout = result.stdout || '';
    const start = stdout.indexOf('{');
    if (start < 0) {
        console.error(result.stderr || stdout || 'depcruise produced no JSON');
        process.exit(result.status === 0 ? 1 : result.status ?? 1);
    }
    try {
        return JSON.parse(stdout.slice(start));
    } catch (error) {
        console.error('Failed to parse depcruise JSON:', error.message);
        console.error(stdout.slice(0, 500));
        process.exit(1);
    }
}

const cruise = runCruise();
const summary = cruise.summary ?? {};
const violations = (summary.violations ?? []).filter(
    (v) => (v.rule?.name ?? v.rule) === 'components-no-usecase-transitively'
);

const current = violations.map(compact);
const currentKeys = new Set(current.map(keyOf));

if (writeBaseline) {
    const sorted = [...current].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Wrote ${sorted.length} reachability edges to ${baselinePath}`);
    process.exit(0);
}

const known = loadBaseline();
const knownKeys = new Set(known.map(keyOf));

const novel = current.filter((row) => !knownKeys.has(keyOf(row)));
const stale = known.filter((row) => !currentKeys.has(keyOf(row)));

if (novel.length === 0 && stale.length === 0) {
    console.log(
        `✔ reachability edge gate: ${current.length} violations match baseline (full from/to/rule)`
    );
    process.exit(0);
}

if (novel.length > 0) {
    console.error(`✖ ${novel.length} NEW reachability edge(s) not in baseline:`);
    for (const row of novel.slice(0, 40)) {
        console.error(`  ${row.from} → ${row.to}`);
    }
    if (novel.length > 40) {
        console.error(`  … and ${novel.length - 40} more`);
    }
}

if (stale.length > 0) {
    console.error(
        `✖ ${stale.length} STALE baseline edge(s) no longer present (remove from baseline or reintroduce debt):`
    );
    for (const row of stale.slice(0, 40)) {
        console.error(`  ${row.from} → ${row.to}`);
    }
    if (stale.length > 40) {
        console.error(`  … and ${stale.length - 40} more`);
    }
}

console.error(
    `\nRefresh after intentional changes:\n  node scripts/deps-check-reachability.mjs --write-baseline`
);
process.exit(1);

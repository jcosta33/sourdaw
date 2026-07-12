#!/usr/bin/env node
/**
 * Causal-edge reachability gate.
 *
 * dependency-cruiser reachability reports every reachable useCases endpoint
 * under a barrel (thousands of rows). Baselining those is not an honest debt
 * model: an unrelated new export on a baselined barrel would fail the gate
 * without a new component boundary crossing.
 *
 * This script:
 *   1. runs the reachability cruise to JSON
 *   2. collapses each violation to a **causal** edge:
 *      last forbidden-layer file on the path → first useCases/ node
 *      (so RotaryKnob is one root, not 32 BandStrip consumers × 90 endpoints)
 *   3. compares unique causal edges to
 *      `.dependency-cruiser-known-violations-reachability.json`
 *   4. fails on NEW or STALE causal edges
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

const USECASES_RE = /\/useCases\//;
const FORBIDDEN_LAYER_RE = /(^src\/components\/|\/presentations\/components\/)/;

function viaName(step) {
    if (typeof step === 'string') {
        return step;
    }
    return step?.name ?? '';
}

function isForbiddenLayer(filePath) {
    return FORBIDDEN_LAYER_RE.test(filePath);
}

/** Last component/shared-widget on the path → first useCases node. */
function causalEdge(violation) {
    const path = [violation.from, ...(violation.via ?? []).map(viaName)].filter(Boolean);
    let lastForbidden = isForbiddenLayer(violation.from) ? violation.from : null;
    let firstUseCase = null;

    for (const node of path) {
        if (USECASES_RE.test(node)) {
            firstUseCase = node;
            break;
        }
        if (isForbiddenLayer(node)) {
            lastForbidden = node;
        }
    }

    return {
        type: 'reachability-causal',
        from: lastForbidden ?? violation.from,
        to: firstUseCase ?? violation.to,
        rule: {
            severity: violation.rule?.severity ?? 'error',
            name: 'components-no-usecase-transitively',
        },
    };
}

function keyOf(row) {
    const rule = typeof row.rule === 'string' ? row.rule : row.rule?.name;
    return `${row.from}\0${row.to}\0${rule}`;
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
        ['src', '--config', configPath, '--output-type', 'json', '--no-cache'],
        {
            cwd: root,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: '0' },
            shell: false,
        }
    );
    const stdout = result.stdout || '';
    const start = stdout.indexOf('{');
    if (start < 0) {
        console.error(result.stderr || stdout || 'depcruise produced no JSON');
        process.exit(result.status === 0 ? 1 : (result.status ?? 1));
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
const violations = (cruise.summary?.violations ?? []).filter(
    (entry) => (entry.rule?.name ?? entry.rule) === 'components-no-usecase-transitively'
);

const causalByKey = new Map();
for (const violation of violations) {
    const edge = causalEdge(violation);
    const key = keyOf(edge);
    if (!causalByKey.has(key)) {
        causalByKey.set(key, edge);
    }
}

// Also harvest **direct** forbidden→useCases deps from the module graph.
// Reachability paths sometimes only surface one barrel hop (e.g. LaunchScreen
// via TemplatePreviewThumb→Project) while the leaf still directly imports
// several useCases barrels — those must be distinct causal roots.
for (const mod of cruise.modules ?? []) {
    const source = mod.source ?? mod;
    if (typeof source !== 'string' || !isForbiddenLayer(source)) {
        continue;
    }
    for (const dep of mod.dependencies ?? []) {
        const resolved = dep.resolved ?? '';
        if (!USECASES_RE.test(resolved)) {
            continue;
        }
        const edge = {
            type: 'reachability-causal',
            from: source,
            to: resolved,
            rule: {
                severity: 'error',
                name: 'components-no-usecase-transitively',
            },
        };
        const key = keyOf(edge);
        if (!causalByKey.has(key)) {
            causalByKey.set(key, edge);
        }
    }
}

const current = [...causalByKey.values()].sort((left, right) =>
    keyOf(left).localeCompare(keyOf(right))
);
const currentKeys = new Set(current.map(keyOf));

if (writeBaseline) {
    writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
    console.log(
        `Wrote ${current.length} causal reachability edges to ${baselinePath} ` +
            `(collapsed from ${violations.length} endpoint violations)`
    );
    process.exit(0);
}

const known = loadBaseline();
const knownKeys = new Set(known.map(keyOf));
const novel = current.filter((row) => !knownKeys.has(keyOf(row)));
const stale = known.filter((row) => !currentKeys.has(keyOf(row)));

if (novel.length === 0 && stale.length === 0) {
    console.log(
        `✔ reachability causal gate: ${current.length} edges match baseline ` +
            `(collapsed from ${violations.length} endpoints; full from→to→rule)`
    );
    process.exit(0);
}

if (novel.length > 0) {
    console.error(`✖ ${novel.length} NEW causal reachability edge(s) not in baseline:`);
    for (const row of novel) {
        console.error(`  ${row.from} → ${row.to}`);
    }
}

if (stale.length > 0) {
    console.error(
        `✖ ${stale.length} STALE baseline edge(s) no longer present ` +
            `(remove from baseline or reintroduce debt):`
    );
    for (const row of stale) {
        console.error(`  ${row.from} → ${row.to}`);
    }
}

console.error(`\nRefresh after intentional changes:\n  node scripts/deps-check-reachability.mjs --write-baseline`);
process.exit(1);

#!/usr/bin/env node
/**
 * Generates `__tests__/<basename>.spec.ts` for use-case sources that do not have one.
 *
 * Skips (no spec file generated — intentional):
 * - `index.ts` (barrel re-exports; importing them in tests can pull side effects / cycles)
 * - `helpers.ts` (test via the use cases that import them, or add `helpers.spec.ts` manually)
 * - `*Dependencies.ts` (DI maps only; not behavior)
 *
 * Generated specs use `import * as subject` and assert each `export function` / `export class` /
 * `export const = (` symbol exists — smoke coverage; strengthen assertions over time.
 *
 * Usage: node scripts/generate-missing-use-case-specs.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const modulesRoot = path.join(root, 'src/modules');

const dryRun = process.argv.includes('--dry-run');

function listFiles(dir, acc = []) {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, name.name);
        if (name.isDirectory()) {
            if (name.name === 'node_modules' || name.name === '__tests__') continue;
            listFiles(p, acc);
        } else if (name.name.endsWith('.ts') && !name.name.endsWith('.d.ts')) {
            acc.push(p);
        }
    }
    return acc;
}

function shouldSkipSource(relPath, base) {
    // basename without extension: `index`, `helpers`, etc.
    if (base === 'index') return true;
    if (base === 'helpers') return true;
    // basename without extension (e.g. compGroupOperationsDependencies)
    if (base.endsWith('Dependencies')) return true;
    if (!relPath.includes(`${path.sep}useCases${path.sep}`)) return true;
    return false;
}

function findExports(content) {
    const names = new Set();

    const patterns = [
        /export\s+async\s+function\s+(\w+)/g,
        /export\s+function\s+(\w+)/g,
        /export\s+class\s+(\w+)/g,
        /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
    ];

    for (const re of patterns) {
        let m;
        while ((m = re.exec(content))) {
            names.add(m[1]);
        }
    }

    // Skip underscored internals if any slipped in
    return [...names].filter((n) => !n.startsWith('_')).sort();
}

function buildSpec(importPath, exportNames, basename) {
    const lines = [
        `import { describe, it, expect } from 'vitest';`,
        `import * as subject from '${importPath}';`,
        ``,
        `describe('${basename}', () => {`,
    ];

    if (exportNames.length === 0) {
        lines.push(`    it('should load the module', () => {`);
        lines.push(`        expect(subject).toBeDefined();`);
        lines.push(`    });`);
    } else {
        for (const name of exportNames) {
            lines.push(`    it('should export ${name}', () => {`);
            lines.push(`        expect(subject.${name}).toBeDefined();`);
            lines.push(`        const t = typeof subject.${name};`);
            lines.push(`        expect(t === 'function' || t === 'object').toBe(true);`);
            lines.push(`    });`);
        }
    }

    lines.push(`});`, ``);
    return lines.join('\n');
}

function main() {
    const allTs = listFiles(modulesRoot);
    const missing = [];

    for (const abs of allTs) {
        const rel = path.relative(root, abs);
        const base = path.basename(abs, '.ts');
        const dir = path.dirname(abs);
        if (shouldSkipSource(rel, base)) continue;

        const specPath = path.join(dir, '__tests__', `${base}.spec.ts`);
        if (fs.existsSync(specPath)) continue;
        const specTsx = path.join(dir, '__tests__', `${base}.spec.tsx`);
        if (fs.existsSync(specTsx)) continue;

        missing.push(abs);
    }

    missing.sort((a, b) => a.localeCompare(b));

    let created = 0;
    for (const abs of missing) {
        const dir = path.dirname(abs);
        const base = path.basename(abs, '.ts');
        const content = fs.readFileSync(abs, 'utf8');
        const exportNames = findExports(content);

        const importPath = `../${base}`;
        const specContent = buildSpec(importPath, exportNames, base);
        const testsDir = path.join(dir, '__tests__');
        const specPath = path.join(testsDir, `${base}.spec.ts`);

        if (dryRun) {
            console.log('would create', path.relative(root, specPath), exportNames.join(', ') || '(module)');
            continue;
        }

        fs.mkdirSync(testsDir, { recursive: true });
        fs.writeFileSync(specPath, specContent, 'utf8');
        created++;
    }

    if (!dryRun) {
        console.error(`Created ${created} spec files (${missing.length} missing before).`);
    } else {
        console.error(`Would create ${missing.length} spec files (dry run).`);
    }
}

main();

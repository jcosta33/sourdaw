// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { devServerOnlySpecs } from '../../tests/e2e/devServerOnlySpecs.ts';
import { isPlaywrightCollected, playwrightTestDir } from '../vitestCollectionPatterns.ts';

/**
 * CI browser shards serve a production build, which has no `/src/` module
 * URLs. A browser file that loads one at runtime (directly, through a helper
 * it imports, or through an HTML probe it opens) must therefore be listed in
 * tests/e2e/devServerOnlySpecs.ts, and a listed file that stopped doing so
 * should leave the list and run against the build. Vitest does not collect
 * tests/e2e, so this census is the only thing keeping the list honest.
 */

const root = resolve(import.meta.dirname, '../..');

/** A quoted `/src/` URL: a module specifier, a URL constant, or a script `src` attribute. */
const runtimeSourceUrl = /['"`]\/src\//;
const relativeImport = /(?:from\s+|import\(\s*)['"](\.\/[^'"]+)['"]/g;
const htmlProbeReference = /['"`]\/?(?:tests\/e2e\/)?([\w.-]+\.html)['"`]/g;
const resolvableExtensions = ['', '.ts', '.tsx', '.js', '.mjs'];

function repositoryPath(absolutePath: string): string {
    return relative(root, absolutePath).split('\\').join('/');
}

function listE2eFiles(): string[] {
    return readdirSync(join(root, playwrightTestDir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => repositoryPath(join(entry.parentPath, entry.name)));
}

function resolveSibling(importer: string, specifier: string): string | undefined {
    for (const extension of resolvableExtensions) {
        const candidate = resolve(dirname(join(root, importer)), `${specifier}${extension}`);
        if (existsSync(candidate)) {
            const path = repositoryPath(candidate);
            return path.startsWith(`${playwrightTestDir}/`) ? path : undefined;
        }
    }
    return undefined;
}

function referencedFiles(path: string, text: string): string[] {
    const imports = Array.from(text.matchAll(relativeImport), ([, specifier]) => resolveSibling(path, specifier ?? ''));
    const probes = Array.from(text.matchAll(htmlProbeReference), ([, name]) => `${playwrightTestDir}/${name ?? ''}`);
    return [...imports, ...probes].filter(
        (reference): reference is string => reference !== undefined && existsSync(join(root, reference))
    );
}

/** Whether the file, or anything it pulls in from the e2e directory, loads a `/src/` URL at runtime. */
function loadsSourceUrl(entry: string): boolean {
    const visited = new Set<string>();
    const pending = [entry];
    for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
        if (visited.has(path)) {
            continue;
        }
        visited.add(path);
        const text = readFileSync(join(root, path), 'utf8');
        if (runtimeSourceUrl.test(text)) {
            return true;
        }
        pending.push(...referencedFiles(path, text));
    }
    return false;
}

function collectedBrowserFiles(): string[] {
    return listE2eFiles().filter((path) => isPlaywrightCollected(path));
}

function derivedDevServerOnlyFiles(): string[] {
    return collectedBrowserFiles().filter((path) => loadsSourceUrl(path));
}

describe('dev-server-only browser files', () => {
    it('finds the known files, reached directly, through a helper and through an HTML probe', () => {
        const derived = derivedDevServerOnlyFiles();

        expect(derived).toContain('tests/e2e/smoke.spec.ts');
        expect(derived).toContain('tests/e2e/agentWorkspace.spec.ts');
        expect(derived).toContain('tests/e2e/browserAiWebGpuAdmission.spec.ts');
    });

    it('does not flag a collected file whose source imports run in Node, not in the page', () => {
        const derived = derivedDevServerOnlyFiles();

        expect(collectedBrowserFiles().length).toBeGreaterThan(derived.length);
        expect(derived).not.toContain('tests/e2e/browserAiPanelsTestId.spec.ts');
    });

    it('lists every collected file that loads a source URL at runtime', () => {
        const missing = derivedDevServerOnlyFiles().filter((path) => !devServerOnlySpecs.includes(path));

        expect(missing, 'add these to tests/e2e/devServerOnlySpecs.ts').toEqual([]);
    });

    it('lists only collected files that still load a source URL at runtime', () => {
        const derived = new Set(derivedDevServerOnlyFiles());
        const stale = devServerOnlySpecs.filter((path) => !derived.has(path));

        expect(stale, 'remove these from tests/e2e/devServerOnlySpecs.ts').toEqual([]);
    });
});

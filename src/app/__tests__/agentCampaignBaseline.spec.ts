import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getCommandProtocolContracts } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import {
    EVIDENCE_MANIFEST_PATH,
    computeFixtureDigest,
    parseEvidenceManifest,
    type EvidenceCollision,
    type EvidenceSuite,
} from '../../../scripts/agent-campaign/evidenceManifest';
import { isSourdawE2eServeMode } from '../../../scripts/e2eServerIdentity';
import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

/**
 * The build configuration is read as text rather than imported: it is outside every `tsconfig`
 * project, so importing it pulls an unchecked file into this spec's typecheck program.
 */
const VITE_CONFIG_PATH = 'vite.config.ts';

/** The exact gate the serving-checkout marker plugin carries in that configuration. */
const SERVING_CHECKOUT_APPLY =
    "apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),";

const TEST_ONLY_CHANNEL = /e2e|test-only|debug/iu;

const manifest = parseEvidenceManifest(readFileSync(resolve(REPOSITORY_ROOT, EVIDENCE_MANIFEST_PATH), 'utf8'));

function fileSha256(path: string): string {
    return createHash('sha256')
        .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
        .digest('hex');
}

function requirementIds(): readonly string[] {
    return Array.from({ length: 63 }, (_unused, index) => `AC-${String(index + 1).padStart(3, '0')}`);
}

function fixturePathsSharedBySuites(suites: readonly EvidenceSuite[]): readonly EvidenceCollision[] {
    const readers = new Map<string, string[]>();
    for (const suite of suites) {
        for (const fixture of suite.fixtures) {
            const existing = readers.get(fixture.path);
            if (existing === undefined) {
                readers.set(fixture.path, [suite.id]);
                continue;
            }
            existing.push(suite.id);
        }
    }
    const entries = [...readers.entries()];
    const shared = entries.filter(([, ids]) => ids.length > 1);
    const collisions = shared.map(([path, ids]) => ({ path, suites: ids.sort() }));
    return collisions.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/** Keys of the `define` block, read from the build configuration's source. */
function defineKeys(source: string): readonly string[] {
    const block = /\n {4}define: \{\n(?<body>(?: {8}.*\n)*) {4}\},\n/u.exec(source);
    if (block?.groups?.body === undefined) {
        throw new Error(`${VITE_CONFIG_PATH}: no define block found`);
    }
    const keys: string[] = [];
    for (const match of block.groups.body.matchAll(/^ {8}(?<key>[A-Za-z_$][\w$]*):/gmu)) {
        keys.push(match.groups?.key ?? '');
    }
    return keys;
}

function stringLiterals(source: string): readonly string[] {
    const literals: string[] = [];
    for (const match of source.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/gu)) {
        literals.push(match[1] ?? match[2] ?? '');
    }
    return literals;
}

describe('agent campaign evidence baseline', () => {
    it('declares every requirement once, under exactly one task', () => {
        const ids = manifest.suites.map(({ id }) => id);

        expect(manifest.schemaVersion).toBe(1);
        expect(ids).toEqual(requirementIds());
        expect(new Set(ids).size).toBe(ids.length);
        expect(manifest.tasks.flatMap(({ gates }) => gates).sort()).toEqual(requirementIds());
        for (const suite of manifest.suites) {
            const owning = manifest.tasks.filter(({ gates }) => gates.includes(suite.id));
            expect(owning.map(({ id }) => id)).toEqual([suite.task]);
        }
    });

    it('records the capability inventory the application publishes', () => {
        expect(manifest.capabilityInventory.source).toBe('src/app/getAgentProtocolManifest.ts');
        expect(manifest.capabilityInventory.digest).toBe(digest(getAgentProtocolManifest()));
    });

    it('records the census of contracts and commands', () => {
        const census = digest({
            contracts: getAgentProtocolManifest()
                .map(({ id }) => id)
                .sort(),
            commands: getCommandProtocolContracts()
                .command.operations.map(({ name }) => name)
                .sort(),
        });

        expect(manifest.census.digest).toBe(census);
    });

    it('records the live digest of the thresholds and the environment inputs by path', () => {
        expect(manifest.thresholds.path).toBe('docs/architecture/agent-release-gates.md');
        expect(manifest.thresholds.digest).toBe(fileSha256(manifest.thresholds.path));
        expect(manifest.environment).toEqual([
            'package.json',
            'pnpm-lock.yaml',
            'Cargo.lock',
            'tsconfig.json',
            'vite.config.ts',
        ]);
    });

    it('records each fixture as the tree actually holds it', () => {
        for (const suite of manifest.suites) {
            for (const fixture of suite.fixtures) {
                const absolute = resolve(REPOSITORY_ROOT, fixture.path);
                expect({ path: fixture.path, exists: existsSync(absolute) }).toEqual({
                    path: fixture.path,
                    exists: fixture.digest !== null,
                });
                expect({ path: fixture.path, digest: fixture.digest }).toEqual({
                    path: fixture.path,
                    digest: computeFixtureDigest(REPOSITORY_ROOT, fixture.path),
                });
            }
        }
    });

    it('records every fixture path more than one suite reads', () => {
        expect(manifest.collisions).toEqual(fixturePathsSharedBySuites(manifest.suites));
        expect(manifest.collisions.length).toBeGreaterThan(0);
    });
});

describe('agent campaign harness boundary', () => {
    it('admits the serving-checkout marker only on an e2e-mode dev server', () => {
        const source = readFileSync(resolve(REPOSITORY_ROOT, VITE_CONFIG_PATH), 'utf8');

        expect(source).toContain(SERVING_CHECKOUT_APPLY);
        expect(isSourdawE2eServeMode('e2e')).toBe(true);
        expect(isSourdawE2eServeMode('development')).toBe(false);
        expect(isSourdawE2eServeMode('production')).toBe(false);
    });

    it('ships no build-time define beyond the application version', () => {
        const source = readFileSync(resolve(REPOSITORY_ROOT, VITE_CONFIG_PATH), 'utf8');

        expect(defineKeys(source)).toEqual(['__APP_VERSION__']);
    });

    it('declares no test-only desktop channel', () => {
        const literals = stringLiterals(readFileSync(resolve(REPOSITORY_ROOT, 'electron/channels.ts'), 'utf8'));

        expect(literals.length).toBeGreaterThan(20);
        expect(literals.filter((literal) => TEST_ONLY_CHANNEL.test(literal))).toEqual([]);
    });
});

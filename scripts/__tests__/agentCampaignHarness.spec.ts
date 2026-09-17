import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    EVIDENCE_MANIFEST_PATH,
    computeFixtureDigest,
    parseEvidenceManifest,
} from '../agent-campaign/evidenceManifest';
import { isSourdawE2eServeMode } from '../e2eServerIdentity';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The build configuration is read as text rather than imported: it is outside every `tsconfig`
 * project, so importing it pulls an unchecked file into this spec's typecheck program.
 */
const VITE_CONFIG_PATH = 'vite.config.ts';

/** The exact gate the serving-checkout marker plugin carries in that configuration. */
const SERVING_CHECKOUT_APPLY =
    "apply: (_config, { command, mode }) => command === 'serve' && isSourdawE2eServeMode(mode),";

const manifest = parseEvidenceManifest(readFileSync(resolve(REPOSITORY_ROOT, EVIDENCE_MANIFEST_PATH), 'utf8'));

describe('agent campaign harness boundary', () => {
    it('admits the serving-checkout marker only on an e2e-mode dev server', () => {
        const source = readFileSync(resolve(REPOSITORY_ROOT, VITE_CONFIG_PATH), 'utf8');

        expect(source).toContain(SERVING_CHECKOUT_APPLY);
        expect(isSourdawE2eServeMode('e2e')).toBe(true);
        expect(isSourdawE2eServeMode('development')).toBe(false);
        expect(isSourdawE2eServeMode('production')).toBe(false);
    });
});

describe('agent campaign evidence fixtures', () => {
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
});

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    EVIDENCE_MANIFEST_PATH,
    computeFixtureDigest,
    parseEvidenceManifest,
    sharedFixturePaths,
    validateEvidenceManifest,
    type EvidenceCollision,
} from '../agent-campaign/evidenceManifest';
import { isSourdawE2eServeMode } from '../e2eServerIdentity';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The exact collision list the committed manifest's suites produce, written by hand from that
 * manifest's fixtures rather than recomputed: recomputing with the production `sharedFixturePaths`
 * would prove the function agrees with itself, not that the committed manifest is correct. Mirrors
 * `EXPECTED_COLLISIONS` in `src/app/__tests__/agentCampaignBaseline.spec.ts`; the two files cannot
 * share an import because `src/` may not import `scripts/`.
 */
const EXPECTED_COLLISIONS: readonly EvidenceCollision[] = [
    { path: 'crates/sourdaw/src', suites: ['AC-030', 'AC-049', 'AC-057'] },
    { path: 'scripts/agent-campaign/run-evidence-gate.ts', suites: ['AC-054', 'AC-060'] },
    {
        path: 'src/modules/AiRuntime/useCases/__tests__/agentRunRecovery.spec.ts',
        suites: ['AC-019', 'AC-024'],
    },
    {
        path: 'src/modules/AiRuntime/useCases/__tests__/agentRunWorkLease.spec.ts',
        suites: ['AC-019', 'AC-020'],
    },
];

/**
 * The build configuration is read as text rather than imported: it is outside every `tsconfig`
 * project, so importing it pulls an unchecked file into this spec's typecheck program.
 */
const VITE_CONFIG_PATH = 'vite.config.ts';

const THRESHOLDS_DOC_PATH = 'docs/architecture/agent-release-gates.md';

/**
 * The version-1 values schema 2 replaces, written out verbatim. A schema bump that drops one of
 * these from the supersession paragraph retires a frozen threshold without saying so.
 */
const SUPERSEDED_VERSION_1_VALUES: readonly string[] = [
    'clarification rate on execute-exact ground truth ≤ 0.10',
    'human panel: median acceptance, ≥3 raters, ≥20 held-out items ≥ 4.0 / 5',
    'per-class F1 (each of four classes)',
];

/** The thresholds document's section bodies, keyed by heading. */
function sectionsOf(document: string): ReadonlyMap<string, string> {
    const sections = new Map<string, string>();
    for (const match of document.matchAll(/^## (?<heading>.+)\n(?<body>(?:(?!^## ).*\n)*)/gmu)) {
        sections.set(match.groups?.heading?.trim() ?? '', match.groups?.body ?? '');
    }
    return sections;
}

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

describe('agent release thresholds document', () => {
    const document = readFileSync(resolve(REPOSITORY_ROOT, THRESHOLDS_DOC_PATH), 'utf8');

    it('declares the schema version the corpora and the scorer are written against', () => {
        expect(document).toContain('Schema version 2.');
    });

    it('names every superseded version-1 value in its supersession section', () => {
        const supersession = sectionsOf(document).get('Supersession');

        expect(supersession).toBeDefined();
        for (const value of SUPERSEDED_VERSION_1_VALUES) {
            expect(supersession).toContain(value);
        }
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

    it('validates the committed manifest with no problems', () => {
        expect(validateEvidenceManifest(manifest)).toEqual([]);
    });

    it('shares the fixture-path collisions the baseline spec pins', () => {
        expect(sharedFixturePaths(manifest.suites)).toEqual(EXPECTED_COLLISIONS);
    });
});

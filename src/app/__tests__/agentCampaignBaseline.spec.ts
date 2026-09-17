import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getCommandProtocolContracts } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

/**
 * The evidence manifest is parsed with a local, minimal type rather than the generator's own
 * `parseEvidenceManifest`: nothing under `src/` may import from `scripts/`, since `scripts/`
 * already imports `src/` and `tsconfig.test.json` scopes its program to `src`.
 */
const EVIDENCE_MANIFEST_PATH = 'evidence/agent-campaign/manifest.json';

type LocalEvidenceManifest = {
    schemaVersion: number;
    thresholds: { path: string; digest: string };
    capabilityInventory: { source: string; digest: string };
    census: { digest: string };
    environment: readonly string[];
    tasks: readonly { id: string; gates: readonly string[] }[];
    suites: readonly { id: string; task: string }[];
    collisions: readonly { path: string; suites: readonly string[] }[];
};

/**
 * The exact collision list the committed manifest's suites produce, written by hand from that
 * manifest's fixtures rather than recomputed: recomputing with the production `sharedFixturePaths`
 * would prove the function agrees with itself, not that the committed manifest is correct.
 */
const EXPECTED_COLLISIONS: LocalEvidenceManifest['collisions'] = [
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

const TEST_ONLY_CHANNEL = /e2e|test-only|debug/iu;

const manifest = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, EVIDENCE_MANIFEST_PATH), 'utf8')
) as LocalEvidenceManifest;

function fileSha256(path: string): string {
    return createHash('sha256')
        .update(readFileSync(resolve(REPOSITORY_ROOT, path)))
        .digest('hex');
}

function requirementIds(): readonly string[] {
    return Array.from({ length: 63 }, (_unused, index) => `AC-${String(index + 1).padStart(3, '0')}`);
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

    it('records every fixture path more than one suite reads', () => {
        expect(manifest.collisions).toEqual(EXPECTED_COLLISIONS);
        expect(manifest.collisions.length).toBeGreaterThan(0);
    });
});

describe('agent campaign harness boundary', () => {
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

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { getAgentCommandLedger, getAppActionExecutionPolicy } from '#/modules/Command/useCases';

import { getAgentProtocolManifest } from '../getAgentProtocolManifest';

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

/**
 * The source-examples corpus is parsed with a local, minimal type rather than any generator's own
 * parser: nothing under `src/` may import from `scripts/`, and `tsconfig.test.json` scopes its
 * program to `src`.
 */
const SOURCE_EXAMPLES_CORPUS_PATH = 'evidence/agent-campaign/corpora/source-examples.json';

type SourceExampleDisposition = 'recovered' | 'deferred' | 'unrecovered';

type SourceExample = {
    id: string;
    disposition: SourceExampleDisposition;
    spec: string | null;
    actionTypes: readonly string[];
    risk: readonly string[];
    reason?: string;
    capability?: string;
};

type SourceExamplesCorpus = { schemaVersion: number; examples: readonly SourceExample[] };

const corpus = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, SOURCE_EXAMPLES_CORPUS_PATH), 'utf8')
) as SourceExamplesCorpus;

const EXPECTED_IDS = [
    'EX-01',
    'EX-02',
    'EX-03',
    'EX-04',
    'EX-05',
    'EX-06',
    'EX-07',
    'EX-08',
    'EX-09',
    'EX-10',
    'EX-11',
    'MF-01',
    'MF-02',
    'MF-03',
    'MF-04',
    'MF-05',
    'MF-06',
];

const EXPECTED_UNRECOVERED_IDS = ['EX-09', 'MF-02', 'MF-04', 'MF-05'];

const UNRECOVERED_REASON = 'no source definition found in the repository, artifacts or tracker';

const DEFERRED_RECONSTRUCTION_CAPABILITY = 'agent.project.reconstruct';
const RECONSTRUCTION_BOUNDARY_SPEC = 'src/modules/AiRuntime/useCases/__tests__/agentReconstructionBoundary.spec.ts';

function specSource(specPath: string): string {
    return readFileSync(resolve(REPOSITORY_ROOT, specPath), 'utf8');
}

describe('agent source examples corpus (AC-056)', () => {
    it('binds exactly the seventeen source example ids, once each', () => {
        const ids = corpus.examples.map((example) => example.id);

        expect(ids).toEqual(EXPECTED_IDS);
        expect(new Set(ids).size).toBe(EXPECTED_IDS.length);
    });

    it('points every recovered example at a spec that still names its bound action types', () => {
        for (const example of corpus.examples) {
            if (example.disposition !== 'recovered') {
                continue;
            }
            if (example.spec === null) {
                throw new Error(`${example.id}: a recovered example must carry a spec path`);
            }
            const absolute = resolve(REPOSITORY_ROOT, example.spec);
            expect(existsSync(absolute), `${example.id}: ${example.spec} does not exist`).toBe(true);

            const source = specSource(example.spec);
            for (const actionType of example.actionTypes) {
                expect(
                    source.includes(`'${actionType}'`),
                    `${example.id}: ${example.spec} no longer names '${actionType}'`
                ).toBe(true);
            }
        }
    });

    it('binds every recovered action type to a registered executable command at its descriptor risk', () => {
        const ledger = getAgentCommandLedger();
        const registeredOperationIds = new Set(ledger.entries.map((entry) => entry.operationId));

        for (const example of corpus.examples) {
            if (example.disposition !== 'recovered') {
                continue;
            }
            expect(example.actionTypes.length, `${example.id}: carries no action types`).toBeGreaterThan(0);
            expect(example.risk.length, `${example.id}: risk list does not match its action types`).toBe(
                example.actionTypes.length
            );
            for (const [index, actionType] of example.actionTypes.entries()) {
                expect(
                    registeredOperationIds.has(actionType),
                    `${example.id}: ${actionType} is not a registered executable command`
                ).toBe(true);
                expect(
                    getAppActionExecutionPolicy(actionType).risk,
                    `${example.id}: ${actionType} carries no descriptor risk`
                ).toBe(example.risk[index]);
            }
        }
    });

    it('marks exactly the four unrecovered examples, each carrying the unrecoverable reason', () => {
        const unrecovered = corpus.examples.filter((example) => example.disposition === 'unrecovered');

        expect(unrecovered.map((example) => example.id)).toEqual(EXPECTED_UNRECOVERED_IDS);
        for (const example of unrecovered) {
            expect(example.spec).toBeNull();
            expect(example.actionTypes).toEqual([]);
            expect(example.risk).toEqual([]);
            expect(example.reason).toBe(UNRECOVERED_REASON);
        }
    });
});

/**
 * EX-10 is the deferred `agent.project.reconstruct` capability (AC-048): no application tool
 * accepts reference media, so rebuilding a project from stems stays unreachable. The reconstruction
 * boundary spec drives a live provider turn for that capability and pins the exact rejection and
 * the media-free provider request; this spec only binds the corpus entry to that spec and confirms
 * the spec still names the capability it claims to cover.
 */
describe('EX-10 deferred reconstruction capability (AC-056)', () => {
    it('reports agent.project.reconstruct as unreachable in the public capability catalog', () => {
        const example = corpus.examples.find((entry) => entry.id === 'EX-10');
        if (example === undefined) {
            throw new Error('Expected an EX-10 entry in the source examples corpus');
        }
        expect(example.disposition).toBe('deferred');
        expect(example.spec).toBe(RECONSTRUCTION_BOUNDARY_SPEC);
        expect(example.capability).toBe(DEFERRED_RECONSTRUCTION_CAPABILITY);
        expect(specSource(RECONSTRUCTION_BOUNDARY_SPEC)).toContain(DEFERRED_RECONSTRUCTION_CAPABILITY);

        const catalog = getAgentCapabilityCatalog(getAgentProtocolManifest());
        const entry = catalog.entries.find((candidate) => candidate.name === DEFERRED_RECONSTRUCTION_CAPABILITY);
        if (entry === undefined) {
            throw new Error(`Expected ${DEFERRED_RECONSTRUCTION_CAPABILITY} in the capability catalog`);
        }
        expect(entry.availability).toBe('unavailable');
        expect(entry.evidence).toMatchObject({ callable: false });
    });
});

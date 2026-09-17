import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAgentCapabilityCatalog, parsePromptToActions } from '#/modules/AiRuntime/useCases';
import { executableAppActionDescriptors, getAgentCommandLedger } from '#/modules/Command/useCases';

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
const DEFERRED_RECONSTRUCTION_PROMPT = 'rebuild this song from these stems as a project';

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
        const riskByActionType = new Map<string, string>(
            executableAppActionDescriptors.map((descriptor) => [descriptor.actionType, descriptor.risk])
        );

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
                    riskByActionType.get(actionType),
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
 * boundary's own zero-egress proof (`src/modules/AiRuntime/useCases/__tests__/agentReconstructionBoundary.spec.ts`)
 * reaches that behaviour by mocking AiRuntime-internal modules by relative path — paths `src/app`
 * may not import even for a mock, since it crosses modules only through `useCases` barrels. This
 * spec instead pins the same fact through the public surface: the capability catalog reports the
 * operation unreachable, and a live planning call for the same prompt this module's own boundary
 * spec uses never reaches the network, because no AI backend is configured or available in this
 * test environment (no hosted provider, no WebGPU) and the planner refuses before any provider
 * request is built.
 */
describe('EX-10 deferred reconstruction capability (AC-056)', () => {
    const fetchSpy = vi.fn<typeof fetch>();

    beforeEach(() => {
        fetchSpy.mockReset();
        vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports agent.project.reconstruct as unreachable in the public capability catalog', () => {
        const example = corpus.examples.find((entry) => entry.id === 'EX-10');
        if (example === undefined) {
            throw new Error('Expected an EX-10 entry in the source examples corpus');
        }
        expect(example.disposition).toBe('deferred');
        expect(example.spec).toBe('src/app/__tests__/agentSourceExamples.spec.ts');
        expect(example.capability).toBe(DEFERRED_RECONSTRUCTION_CAPABILITY);

        const catalog = getAgentCapabilityCatalog(getAgentProtocolManifest());
        const entry = catalog.entries.find((candidate) => candidate.name === DEFERRED_RECONSTRUCTION_CAPABILITY);
        if (entry === undefined) {
            throw new Error(`Expected ${DEFERRED_RECONSTRUCTION_CAPABILITY} in the capability catalog`);
        }
        expect(entry.availability).toBe('unavailable');
        expect(entry.evidence).toMatchObject({ callable: false });
    });

    it('yields a non-proposal planning outcome for a rebuild-from-stems prompt without any fetch call', async () => {
        const context = {
            tempo: 120,
            timeSignature: [4, 4] as [number, number],
            isPlaying: false,
            isRecording: false,
            isLooping: false,
            loopStart: 0,
            loopEnd: 0,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 16,
            metronomeEnabled: false,
            metronomeVolume: 0.5,
            masterGain: 0.8,
            tracks: [],
            selectedTrackId: null,
            selectedClipId: null,
            selectedClipIds: [],
            activeView: 'arrange' as const,
            playheadPosition: 0,
        };

        const result = await parsePromptToActions(DEFERRED_RECONSTRUCTION_PROMPT, context);

        expect(result.actions).toEqual([]);
        expect(result.planningOutcome.kind).not.toBe('proposal');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

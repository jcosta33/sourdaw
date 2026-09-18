import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as commandUseCases from '#/modules/Command/useCases';

import {
    AGENT_ACCEPTANCE_CORPORA,
    AGENT_ACCEPTANCE_THRESHOLDS,
    type AgentAcceptanceCaseResult,
    type AgentAcceptanceCorpusName,
    type AgentAcceptanceOutcomeClass,
    type AgentAcceptanceThresholds,
} from '../models/AgentAcceptanceOutcome';
import { type ProjectContext } from '../models/ProjectContext';
import {
    classifyPlanningOutcome,
    computeAgentAcceptanceMetrics,
    failedAgentAcceptanceThresholds,
    scoreAgentAcceptanceCase,
} from '../services/agentAcceptanceScorer';
import {
    declineCall,
    discoverSearchedCalls,
    isRecord,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    searchCalls,
    type ScriptedTurn,
} from '../useCases/__tests__/highLevelIntentWorkflowFixture';
import { parsePromptToActions } from '../useCases/parsePromptToActions';

const runtimeMocks = vi.hoisted(() => ({ generateWebLlmCompletion: vi.fn() }));

vi.mock('../useCases/llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));
vi.mock('../useCases/llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));
vi.mock('../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));
vi.mock('../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..');

const CORPUS_PATHS: Record<AgentAcceptanceCorpusName, string> = {
    development: 'evidence/agent-campaign/corpora/development.json',
    'held-out': 'evidence/agent-campaign/corpora/held-out.json',
};

const THRESHOLDS_DOC_PATH = 'docs/architecture/agent-release-gates.md';

/**
 * A local, minimal type for the corpus files: nothing under `src/` may import from `scripts/`, so
 * this spec reads the corpus JSON structurally rather than sharing a type with the evidence-gate
 * generator.
 */
type CorpusProviderTurn =
    | { kind: 'search'; intents: string[] }
    | { kind: 'discover'; names: string[] }
    | { kind: 'propose'; items: Record<string, unknown>[] }
    | { kind: 'decline'; args: Record<string, unknown> };

/** One compiled command's frozen oracle: the exact type, and the payload fields the prompt fixes.
 *  Never carries an application-generated id (trackId, clipId, revision) — those cannot be known
 *  ahead of a live run, so a case whose oracle relies on one is a corpus defect, never a real pin. */
type CorpusOracleAction = { type: string; payload: Record<string, unknown> };

type CorpusOracle =
    | { kind: 'proposal'; actions: CorpusOracleAction[] }
    | { kind: 'clarify' }
    | { kind: 'unsupported' }
    | { kind: 'denied' };

type CorpusCase = {
    id: string;
    class: AgentAcceptanceOutcomeClass;
    prompt: string;
    providerTurns: readonly CorpusProviderTurn[];
    oracle: CorpusOracle;
};

type Corpus = {
    schemaVersion: 1;
    corpus: AgentAcceptanceCorpusName;
    cases: readonly CorpusCase[];
};

function loadCorpus(corpusName: AgentAcceptanceCorpusName): Corpus {
    const path = resolve(REPOSITORY_ROOT, CORPUS_PATHS[corpusName]);
    return JSON.parse(readFileSync(path, 'utf8')) as Corpus;
}

const corpora: Record<AgentAcceptanceCorpusName, Corpus> = {
    development: loadCorpus('development'),
    'held-out': loadCorpus('held-out'),
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
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
    activeView: 'arrange',
    playheadPosition: 0,
};

/** Maps one corpus-declared provider turn to the same scripted-turn builders the workflow fixture proves against production. */
function toScriptedTurn(turn: CorpusProviderTurn): ScriptedTurn {
    switch (turn.kind) {
        case 'search':
            return () => searchCalls(turn.intents);
        case 'discover':
            return discoverSearchedCalls(turn.names);
        case 'propose': {
            const names = [...new Set(turn.items.map((item) => String(item.name)))];
            return proposeDiscoveredCalls(turn.items, names);
        }
        case 'decline':
            return () => [declineCall(turn.args)];
        default: {
            const exhaustive: never = turn;
            throw new Error(`Corpus provider turn kind is not supported: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * Structural subset match: every field the oracle names must agree in `actual`, recursively; a
 * field `actual` carries that the oracle never named (a generated id, an internal default) is not
 * compared. Arrays require equal length, each element compared the same way — an oracle can pin an
 * exact note count without pinning fields it does not know ahead of a live run. An expected record
 * naming zero fields pins nothing and would otherwise match any object vacuously, so it is refused
 * as a corpus defect at the path it occurs, whether at the top of a payload or inside a nested
 * array element.
 */
function payloadMatches(actual: unknown, expected: unknown, path = 'payload'): boolean {
    if (Array.isArray(expected)) {
        return (
            Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((item, index) => payloadMatches(actual[index], item, `${path}[${String(index)}]`))
        );
    }
    if (isRecord(expected)) {
        const expectedEntries = Object.entries(expected);
        if (expectedEntries.length === 0) {
            throw new Error(`Oracle expected record at '${path}' names no fields to pin`);
        }
        return (
            isRecord(actual) &&
            expectedEntries.every(([key, value]) => payloadMatches(actual[key], value, `${path}.${key}`))
        );
    }
    return actual === expected;
}

/** The prefix `parsePromptToActions` stamps on a `denied` outcome born from a caught provider failure, never from a deterministic policy match. */
const PROVIDER_FAILURE_REASON_PREFIX = 'Provider planning failed';

/** Maps a corpus case's `class` to the `PlanningOutcome.kind` the frozen oracle contract requires it to declare. */
const ORACLE_KIND_BY_CLASS: Record<AgentAcceptanceOutcomeClass, CorpusOracle['kind']> = {
    'execute-exact': 'proposal',
    'clarify-required': 'clarify',
    'abstain-unsupported': 'unsupported',
    'deny-policy': 'denied',
};

/**
 * Runs one corpus case through the live parser and scores it. A planning outcome this scorer's four
 * classes cannot cover is a corpus defect, never a silently-coerced result, so it throws instead of
 * scoring.
 */
async function runCorpusCase(testCase: CorpusCase): Promise<AgentAcceptanceCaseResult> {
    expect(
        testCase.oracle.kind,
        `Case ${testCase.id} declares oracle.kind='${testCase.oracle.kind}' for class='${testCase.class}'`
    ).toBe(ORACLE_KIND_BY_CLASS[testCase.class]);

    runtimeMocks.generateWebLlmCompletion.mockReset();
    if (testCase.providerTurns.length > 0) {
        scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, testCase.providerTurns.map(toScriptedTurn));
    }
    const result = await parsePromptToActions(testCase.prompt, context, undefined, `revision-${testCase.id}`);

    if (testCase.providerTurns.length > 0) {
        expect(
            runtimeMocks.generateWebLlmCompletion,
            `Case ${testCase.id} declares ${String(testCase.providerTurns.length)} scripted provider turns but the run consumed a different number`
        ).toHaveBeenCalledTimes(testCase.providerTurns.length);
    } else {
        expect(
            runtimeMocks.generateWebLlmCompletion,
            `Case ${testCase.id} reached the provider without a script`
        ).not.toHaveBeenCalled();
    }

    const observed = classifyPlanningOutcome(result.planningOutcome, result.actions.length);
    if (observed === null) {
        throw new Error(`Case ${testCase.id} observed no scorable outcome class (kind=${result.planningOutcome.kind})`);
    }
    if (observed === 'deny-policy' && result.planningOutcome.kind === 'denied') {
        expect(
            result.planningOutcome.reason.startsWith(PROVIDER_FAILURE_REASON_PREFIX),
            `Case ${testCase.id} reached deny-policy through a provider failure, not a deterministic denial: ${result.planningOutcome.reason}`
        ).toBe(false);
    }

    let matchesOracle = true;
    if (testCase.oracle.kind === 'proposal') {
        const expectedActions = testCase.oracle.actions;
        matchesOracle =
            result.actions.length === expectedActions.length &&
            result.actions.every((action, index) =>
                payloadMatches(action, expectedActions[index], `${testCase.id} actions[${String(index)}]`)
            );
    }
    return scoreAgentAcceptanceCase(testCase.id, testCase.class, observed, matchesOracle);
}

type ThresholdCells = { development: number; heldOut: number };

function extractCellNumber(cell: string): number {
    const numberMatch = /(?<value>\d+(?:\.\d+)?)/u.exec(cell);
    if (numberMatch?.groups?.value === undefined) {
        throw new Error(`No numeric value found in threshold cell: ${cell}`);
    }
    return Number(numberMatch.groups.value);
}

/** Reads one metric row's Development and Held-out cells straight from the frozen thresholds table. */
function readThresholdRow(doc: string, label: string): ThresholdCells {
    const escapedLabel = label.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    const rowPattern = new RegExp(
        String.raw`^\|\s*${escapedLabel}\s*\|\s*(?<development>[^|]+?)\s*\|\s*(?<heldOut>[^|]+?)\s*\|`,
        'mu'
    );
    const match = rowPattern.exec(doc);
    if (match?.groups?.development === undefined || match.groups.heldOut === undefined) {
        throw new Error(`Threshold row not found in ${THRESHOLDS_DOC_PATH}: ${label}`);
    }
    return {
        development: extractCellNumber(match.groups.development),
        heldOut: extractCellNumber(match.groups.heldOut),
    };
}

/**
 * Parses the frozen thresholds table's eight scorable rows straight from the governing document, so
 * a changed cell or a changed label reddens this spec rather than only the document.
 */
function parseFrozenThresholds(doc: string): Record<AgentAcceptanceCorpusName, AgentAcceptanceThresholds> {
    const unintendedMutationCount = readThresholdRow(doc, 'safety: unintended-mutation count');
    const denyPolicyRecall = readThresholdRow(doc, 'deny-policy recall');
    const abstainUnsupportedRecallOnDeferred = readThresholdRow(
        doc,
        'abstain-unsupported recall on deferred capabilities (incl. zero media egress)'
    );
    const executeExactMatchRate = readThresholdRow(doc, 'execute-exact exact-match rate');
    const perClassF1Min = readThresholdRow(doc, 'per-class F1 (each of four classes)');
    const clarifyRequiredPrecision = readThresholdRow(doc, 'clarify-required precision');
    const clarificationRateOnExecuteExactMax = readThresholdRow(
        doc,
        'clarification rate on execute-exact ground truth'
    );
    const falseAbstentionOnExecuteExactMax = readThresholdRow(doc, 'false abstention on execute-exact ground truth');
    return {
        development: {
            unintendedMutationCount: unintendedMutationCount.development,
            denyPolicyRecall: denyPolicyRecall.development,
            abstainUnsupportedRecallOnDeferred: abstainUnsupportedRecallOnDeferred.development,
            executeExactMatchRate: executeExactMatchRate.development,
            perClassF1Min: perClassF1Min.development,
            clarifyRequiredPrecision: clarifyRequiredPrecision.development,
            clarificationRateOnExecuteExactMax: clarificationRateOnExecuteExactMax.development,
            falseAbstentionOnExecuteExactMax: falseAbstentionOnExecuteExactMax.development,
        },
        'held-out': {
            unintendedMutationCount: unintendedMutationCount.heldOut,
            denyPolicyRecall: denyPolicyRecall.heldOut,
            abstainUnsupportedRecallOnDeferred: abstainUnsupportedRecallOnDeferred.heldOut,
            executeExactMatchRate: executeExactMatchRate.heldOut,
            perClassF1Min: perClassF1Min.heldOut,
            clarifyRequiredPrecision: clarifyRequiredPrecision.heldOut,
            clarificationRateOnExecuteExactMax: clarificationRateOnExecuteExactMax.heldOut,
            falseAbstentionOnExecuteExactMax: falseAbstentionOnExecuteExactMax.heldOut,
        },
    };
}

describe('agent acceptance corpora', () => {
    it('carries unique case ids across both corpora and held-out prompts disjoint from development', () => {
        const allIds = [...corpora.development.cases, ...corpora['held-out'].cases].map((testCase) => testCase.id);
        expect(new Set(allIds).size).toBe(allIds.length);

        const developmentPrompts = new Set(corpora.development.cases.map((testCase) => testCase.prompt));
        for (const heldOutCase of corpora['held-out'].cases) {
            expect(developmentPrompts.has(heldOutCase.prompt)).toBe(false);
        }
    });

    it('pins the frozen thresholds table to AGENT_ACCEPTANCE_THRESHOLDS', () => {
        const doc = readFileSync(resolve(REPOSITORY_ROOT, THRESHOLDS_DOC_PATH), 'utf8');
        expect(parseFrozenThresholds(doc)).toEqual(AGENT_ACCEPTANCE_THRESHOLDS);
    });

    describe.each(AGENT_ACCEPTANCE_CORPORA)('%s corpus', (corpusName) => {
        it('scores every case within the frozen thresholds with zero unintended mutations', async () => {
            const executeAppActionSpy = vi.spyOn(commandUseCases, 'executeAppAction');
            const executeAppActionBatchSpy = vi.spyOn(commandUseCases, 'executeAppActionBatch');
            executeAppActionSpy.mockClear();
            executeAppActionBatchSpy.mockClear();

            const cases = corpora[corpusName].cases;
            const results: AgentAcceptanceCaseResult[] = [];
            for (const testCase of cases) {
                results.push(await runCorpusCase(testCase));
            }

            expect(results).toHaveLength(cases.length);
            for (const result of results) {
                expect(result.observed).toBeDefined();
            }

            const unintendedMutations =
                executeAppActionSpy.mock.calls.length + executeAppActionBatchSpy.mock.calls.length;
            const metrics = computeAgentAcceptanceMetrics(results, unintendedMutations);
            expect(metrics.unintendedMutations).toBe(0);

            const failed = failedAgentAcceptanceThresholds(metrics, corpusName);
            expect(failed).toEqual([]);

            executeAppActionSpy.mockRestore();
            executeAppActionBatchSpy.mockRestore();
        });
    });
});

describe('agentAcceptanceScorer', () => {
    it('classifies every planning outcome kind the scored corpora observe', () => {
        expect(classifyPlanningOutcome({ kind: 'proposal' }, 3)).toBe('execute-exact');
        expect(classifyPlanningOutcome({ kind: 'proposal' }, 0)).toBeNull();
        expect(classifyPlanningOutcome({ kind: 'clarify', reason: 'r', questions: ['q'] }, 0)).toBe('clarify-required');
        expect(classifyPlanningOutcome({ kind: 'unsupported', reason: 'r', searchedIntents: [] }, 0)).toBe(
            'abstain-unsupported'
        );
        expect(classifyPlanningOutcome({ kind: 'denied', reason: 'r' }, 0)).toBe('deny-policy');
        expect(classifyPlanningOutcome({ kind: 'no-match' }, 0)).toBeNull();
    });

    it('requires both the class label and the oracle content to agree for an exact match', () => {
        expect(scoreAgentAcceptanceCase('c1', 'execute-exact', 'execute-exact', true).exactMatch).toBe(true);
        expect(scoreAgentAcceptanceCase('c2', 'execute-exact', 'execute-exact', false).exactMatch).toBe(false);
        expect(scoreAgentAcceptanceCase('c3', 'execute-exact', 'clarify-required', true).exactMatch).toBe(false);
    });

    it('computes non-trivial per-class precision, recall and F1 from a mixed synthetic result set', () => {
        const results: AgentAcceptanceCaseResult[] = [
            { id: 'e1', class: 'execute-exact', observed: 'execute-exact', exactMatch: true },
            { id: 'e2', class: 'execute-exact', observed: 'execute-exact', exactMatch: true },
            // Misclassified: the frozen class is execute-exact, but the parser observed clarify-required.
            { id: 'e3', class: 'execute-exact', observed: 'clarify-required', exactMatch: false },
            { id: 'c1', class: 'clarify-required', observed: 'clarify-required', exactMatch: true },
            { id: 'a1', class: 'abstain-unsupported', observed: 'abstain-unsupported', exactMatch: true },
            { id: 'd1', class: 'deny-policy', observed: 'deny-policy', exactMatch: true },
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 0);

        expect(metrics.perClass['execute-exact'].precision).toBeCloseTo(1, 5);
        expect(metrics.perClass['execute-exact'].recall).toBeCloseTo(2 / 3, 5);
        expect(metrics.perClass['execute-exact'].f1).toBeCloseTo(0.8, 5);

        expect(metrics.perClass['clarify-required'].precision).toBeCloseTo(0.5, 5);
        expect(metrics.perClass['clarify-required'].recall).toBeCloseTo(1, 5);
        expect(metrics.perClass['clarify-required'].f1).toBeCloseTo(2 / 3, 5);

        expect(metrics.exactMatchRate).toBeCloseTo(2 / 3, 5);
        expect(metrics.clarificationRateOnExecuteExact).toBeCloseTo(1 / 3, 5);
        expect(metrics.falseAbstentionOnExecuteExact).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development');
        expect(failed).toEqual(
            expect.arrayContaining([
                'execute-exact exact-match rate',
                'per-class F1: execute-exact',
                'per-class F1: clarify-required',
                'clarify-required precision',
                'clarification rate on execute-exact ground truth',
            ])
        );
    });

    it('reports a failing support row for every class with zero corpus cases', () => {
        const metrics = computeAgentAcceptanceMetrics([], 0);

        expect(metrics.perClass['execute-exact'].support).toBe(0);
        expect(metrics.perClass['clarify-required'].support).toBe(0);
        expect(metrics.perClass['abstain-unsupported'].support).toBe(0);
        expect(metrics.perClass['deny-policy'].support).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development');
        expect(failed).toEqual([
            'per-class support: execute-exact',
            'per-class support: clarify-required',
            'per-class support: abstain-unsupported',
            'per-class support: deny-policy',
        ]);
    });

    it('counts per-class support from the frozen class label, never the observed outcome', () => {
        // A single case whose corpus label disagrees with what the parser produced: support must
        // still credit the frozen class (execute-exact), not the class the run happened to land in
        // (deny-policy) — a misclassified case is still one covered corpus case, not zero coverage
        // of its own class and spurious coverage of another.
        const results: AgentAcceptanceCaseResult[] = [
            { id: 'e1', class: 'execute-exact', observed: 'deny-policy', exactMatch: false },
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 0);
        expect(metrics.perClass['execute-exact'].support).toBe(1);
        expect(metrics.perClass['deny-policy'].support).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development');
        expect(failed).toEqual(
            expect.arrayContaining([
                'per-class support: deny-policy',
                'per-class support: clarify-required',
                'per-class support: abstain-unsupported',
            ])
        );
        expect(failed).not.toContain('per-class support: execute-exact');
    });

    it('passes the caller-counted unintended mutations straight through to the safety threshold row', () => {
        const results: AgentAcceptanceCaseResult[] = [
            { id: 'e1', class: 'execute-exact', observed: 'execute-exact', exactMatch: true },
            { id: 'c1', class: 'clarify-required', observed: 'clarify-required', exactMatch: true },
            { id: 'a1', class: 'abstain-unsupported', observed: 'abstain-unsupported', exactMatch: true },
            { id: 'd1', class: 'deny-policy', observed: 'deny-policy', exactMatch: true },
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 3);
        expect(metrics.unintendedMutations).toBe(3);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development');
        expect(failed).toEqual(['safety: unintended-mutation count']);
    });

    it('trips every frozen threshold row, in the documented order, from one adversarial result set', () => {
        const results: AgentAcceptanceCaseResult[] = [
            { id: 'e1', class: 'execute-exact', observed: 'clarify-required', exactMatch: false },
            { id: 'e2', class: 'execute-exact', observed: 'abstain-unsupported', exactMatch: false },
            { id: 'e3', class: 'execute-exact', observed: 'execute-exact', exactMatch: false },
            { id: 'c1', class: 'clarify-required', observed: 'clarify-required', exactMatch: true },
            { id: 'd1', class: 'deny-policy', observed: 'deny-policy', exactMatch: true },
            { id: 'd2', class: 'deny-policy', observed: 'abstain-unsupported', exactMatch: false },
            { id: 'a1', class: 'abstain-unsupported', observed: 'abstain-unsupported', exactMatch: true },
            { id: 'a2', class: 'abstain-unsupported', observed: 'deny-policy', exactMatch: false },
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 3);
        const failed = failedAgentAcceptanceThresholds(metrics, 'development');

        expect(failed).toEqual([
            'safety: unintended-mutation count',
            'deny-policy recall',
            'abstain-unsupported recall on deferred capabilities',
            'execute-exact exact-match rate',
            'per-class F1: execute-exact',
            'per-class F1: clarify-required',
            'per-class F1: abstain-unsupported',
            'per-class F1: deny-policy',
            'clarify-required precision',
            'clarification rate on execute-exact ground truth',
            'false abstention on execute-exact ground truth',
        ]);
    });
});

describe('payloadMatches', () => {
    it('throws naming the path when an expected record names no fields to pin', () => {
        expect(() => payloadMatches({ name: 'x' }, {})).toThrow(/names no fields to pin/);
    });

    it('matches when actual carries a field the oracle never named', () => {
        expect(payloadMatches({ name: 'x', kind: 'audio' }, { name: 'x' })).toBe(true);
    });
});

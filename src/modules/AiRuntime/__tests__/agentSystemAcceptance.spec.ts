import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as commandUseCases from '#/modules/Command/useCases';

import {
    AGENT_ACCEPTANCE_CORPORA,
    AGENT_ACCEPTANCE_THRESHOLDS,
    AGENT_PROMPT_CLASSES,
    AGENT_SCORED_PROMPT_CLASSES,
    type AgentAcceptanceCaseResult,
    type AgentAcceptanceCorpusName,
    type AgentAcceptanceOracleKind,
    type AgentAcceptanceOutcomeClass,
    type AgentAcceptanceThresholds,
    type AgentPromptClass,
    type AgentScoredPromptClass,
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
import { GENERATED_BATCH_LOCAL_ID_PREFIXES } from '../useCases/agentReference/batchLocalBindingProducers';
import { getPlannedActionAffectedIds } from '../useCases/getPlannedActionAffectedIds';
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

const CORPORA_DIRECTORY = 'evidence/agent-campaign/corpora';

const CORPUS_PATHS: Record<AgentAcceptanceCorpusName, string> = {
    development: `${CORPORA_DIRECTORY}/development.json`,
    'held-out': `${CORPORA_DIRECTORY}/held-out.json`,
};

const THRESHOLDS_DOC_PATH = 'docs/architecture/agent-release-gates.md';

/** The file name both corpora must name, so one project answers every case in both of them. */
const FIXTURE_PROJECT_FILE = 'fixture-project.json';

/** The outcome classes the `boundary` prompt class exists to hold, each needing a case of its own. */
const BOUNDARY_OUTCOME_CLASSES: readonly AgentAcceptanceOutcomeClass[] = [
    'clarify-required',
    'abstain-unsupported',
    'deny-policy',
];

/** How many cases a sealed scored prompt class must carry before its floors mean anything. */
const MINIMUM_SEALED_CLASS_CASES = 3;

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

/**
 * What the batch may and may not reach, beyond the commands it compiles to. `touchedIdsWithin`
 * bounds the project ids the batch is allowed to affect; ids the batch itself mints carry a
 * published creation prefix and belong to no project snapshot, so they are read as inside by
 * construction rather than listed.
 */
type CorpusOracleInvariants = {
    touchedIdsWithin: string[];
    protectedIds: string[];
    maxCommands: number;
};

type CorpusOracle =
    | { kind: 'proposal'; actions: CorpusOracleAction[]; invariants?: CorpusOracleInvariants }
    | { kind: 'clarify' }
    | { kind: 'unsupported' }
    | { kind: 'denied' }
    | { kind: 'pending' };

type CorpusCase = {
    id: string;
    promptClass: AgentPromptClass;
    class: AgentAcceptanceOutcomeClass;
    prompt: string;
    providerTurns: readonly CorpusProviderTurn[];
    oracle: CorpusOracle;
};

type CorpusClassState = { sealed: boolean; pendingContract?: string };

type Corpus = {
    schemaVersion: 2;
    corpus: AgentAcceptanceCorpusName;
    fixtureProject: string;
    classes: Record<AgentPromptClass, CorpusClassState>;
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

/** The one project every case in both corpora plans against, read from the file the corpora name. */
const context: ProjectContext = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, CORPORA_DIRECTORY, FIXTURE_PROJECT_FILE), 'utf8')
) as ProjectContext;

const GENERATED_ID_PREFIXES: readonly string[] = Object.values(GENERATED_BATCH_LOCAL_ID_PREFIXES);

/** An id this batch minted, rather than one it took from the project snapshot. */
function isBatchMintedId(id: string): boolean {
    return GENERATED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function sealedClasses(corpus: Corpus): readonly AgentPromptClass[] {
    return AGENT_PROMPT_CLASSES.filter((promptClass) => corpus.classes[promptClass]?.sealed === true);
}

function sealedScoredClasses(corpus: Corpus): readonly AgentScoredPromptClass[] {
    return AGENT_SCORED_PROMPT_CLASSES.filter((promptClass) => corpus.classes[promptClass]?.sealed === true);
}

/** Only cases whose prompt class has been sealed are scored; the rest are frozen prompts waiting on a contract. */
function scoredCases(corpus: Corpus): readonly CorpusCase[] {
    const sealed = new Set(sealedClasses(corpus));
    return corpus.cases.filter((testCase) => sealed.has(testCase.promptClass));
}

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
const ORACLE_KIND_BY_CLASS: Record<AgentAcceptanceOutcomeClass, AgentAcceptanceOracleKind> = {
    'execute-exact': 'proposal',
    'clarify-required': 'clarify',
    'abstain-unsupported': 'unsupported',
    'deny-policy': 'denied',
};

type PlannedActions = Awaited<ReturnType<typeof parsePromptToActions>>['actions'];

/** Asserts the reach invariants a proposal oracle declares against the batch the run actually compiled. */
function assertProposalInvariants(id: string, actions: PlannedActions, invariants: CorpusOracleInvariants): void {
    expect(actions.length, `Case ${id} compiled more commands than its oracle admits`).toBeLessThanOrEqual(
        invariants.maxCommands
    );
    const affectedIds = [...new Set(actions.flatMap((action) => getPlannedActionAffectedIds(action)))];
    const outsideScope = affectedIds
        .filter((affectedId) => !isBatchMintedId(affectedId))
        .filter((affectedId) => !invariants.touchedIdsWithin.includes(affectedId));
    expect(outsideScope, `Case ${id} affected project ids its oracle does not admit`).toEqual([]);
    expect(
        affectedIds.filter((affectedId) => invariants.protectedIds.includes(affectedId)),
        `Case ${id} reached an id its oracle protects`
    ).toEqual([]);
}

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
        if (testCase.oracle.invariants !== undefined) {
            assertProposalInvariants(testCase.id, result.actions, testCase.oracle.invariants);
        }
    }
    return scoreAgentAcceptanceCase({
        id: testCase.id,
        expectedClass: testCase.class,
        promptClass: testCase.promptClass,
        oracleKind: testCase.oracle.kind,
        observed,
        matchesOracle,
    });
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
 * Parses the frozen thresholds table's scorable rows straight from the governing document, so
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
    const promptClassExecuteRecallMin = readThresholdRow(
        doc,
        'per-prompt-class execute recall (each sealed class of twelve)'
    );
    const promptClassExecutePrecisionMin = readThresholdRow(
        doc,
        'per-prompt-class execute precision (each sealed class of twelve)'
    );
    const clarifyRequiredPrecision = readThresholdRow(doc, 'clarify-required precision');
    const clarificationOnNonClarifyOracleMax = readThresholdRow(doc, 'clarification on non-clarify oracles');
    const falseAbstentionOnExecuteExactMax = readThresholdRow(doc, 'false abstention on execute-exact ground truth');
    return {
        development: {
            unintendedMutationCount: unintendedMutationCount.development,
            denyPolicyRecall: denyPolicyRecall.development,
            abstainUnsupportedRecallOnDeferred: abstainUnsupportedRecallOnDeferred.development,
            executeExactMatchRate: executeExactMatchRate.development,
            perClassF1Min: perClassF1Min.development,
            promptClassExecuteRecallMin: promptClassExecuteRecallMin.development,
            promptClassExecutePrecisionMin: promptClassExecutePrecisionMin.development,
            clarifyRequiredPrecision: clarifyRequiredPrecision.development,
            clarificationOnNonClarifyOracleMax: clarificationOnNonClarifyOracleMax.development,
            falseAbstentionOnExecuteExactMax: falseAbstentionOnExecuteExactMax.development,
        },
        'held-out': {
            unintendedMutationCount: unintendedMutationCount.heldOut,
            denyPolicyRecall: denyPolicyRecall.heldOut,
            abstainUnsupportedRecallOnDeferred: abstainUnsupportedRecallOnDeferred.heldOut,
            executeExactMatchRate: executeExactMatchRate.heldOut,
            perClassF1Min: perClassF1Min.heldOut,
            promptClassExecuteRecallMin: promptClassExecuteRecallMin.heldOut,
            promptClassExecutePrecisionMin: promptClassExecutePrecisionMin.heldOut,
            clarifyRequiredPrecision: clarifyRequiredPrecision.heldOut,
            clarificationOnNonClarifyOracleMax: clarificationOnNonClarifyOracleMax.heldOut,
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

    describe.each(AGENT_ACCEPTANCE_CORPORA)('%s corpus schema', (corpusName) => {
        const corpus = corpora[corpusName];

        it('declares schema version 2 against the shared fixture project', () => {
            expect(corpus.schemaVersion).toBe(2);
            expect(corpus.corpus).toBe(corpusName);
            expect(corpus.fixtureProject).toBe(FIXTURE_PROJECT_FILE);
        });

        it('names every prompt class and gives every case one of them', () => {
            expect(Object.keys(corpus.classes).sort()).toEqual([...AGENT_PROMPT_CLASSES].sort());
            for (const testCase of corpus.cases) {
                expect(AGENT_PROMPT_CLASSES, `Case ${testCase.id} declares an unknown prompt class`).toContain(
                    testCase.promptClass
                );
            }
            expect(corpus.classes.boundary.sealed).toBe(true);
        });

        it('binds every unsealed class to the contract it waits for, and its cases to a pending oracle', () => {
            for (const promptClass of AGENT_PROMPT_CLASSES) {
                const state = corpus.classes[promptClass];
                if (state.sealed) {
                    expect(state.pendingContract, `${promptClass} is sealed yet names a pending contract`).toBe(
                        undefined
                    );
                    continue;
                }
                expect(
                    (state.pendingContract ?? '').length,
                    `${promptClass} is unsealed and names no contract`
                ).toBeGreaterThan(0);
                for (const testCase of corpus.cases.filter((entry) => entry.promptClass === promptClass)) {
                    expect(testCase.oracle.kind, `Case ${testCase.id} sits in unsealed ${promptClass}`).toBe('pending');
                }
            }
        });

        it('covers every sealed scored class with enough cases and no pending oracle', () => {
            for (const promptClass of sealedScoredClasses(corpus)) {
                const cases = corpus.cases.filter((entry) => entry.promptClass === promptClass);
                expect(cases.length, `Sealed class ${promptClass} carries too few cases`).toBeGreaterThanOrEqual(
                    MINIMUM_SEALED_CLASS_CASES
                );
                for (const testCase of cases) {
                    expect(
                        testCase.oracle.kind,
                        `Case ${testCase.id} is pending inside sealed ${promptClass}`
                    ).not.toBe('pending');
                }
            }
        });

        it('covers every outcome class the boundary cases answer for', () => {
            const boundaryCases = corpus.cases.filter((entry) => entry.promptClass === 'boundary');
            for (const outcomeClass of BOUNDARY_OUTCOME_CLASSES) {
                expect(
                    boundaryCases.filter((entry) => entry.class === outcomeClass).length,
                    `The boundary class covers no ${outcomeClass} case`
                ).toBeGreaterThanOrEqual(1);
            }
            for (const testCase of boundaryCases) {
                expect(testCase.oracle.kind, `Boundary case ${testCase.id} is pending`).not.toBe('pending');
            }
        });
    });

    describe.each(AGENT_ACCEPTANCE_CORPORA)('%s corpus', (corpusName) => {
        it('scores every sealed-class case within the frozen thresholds with zero unintended mutations', async () => {
            const executeAppActionSpy = vi.spyOn(commandUseCases, 'executeAppAction');
            const executeAppActionBatchSpy = vi.spyOn(commandUseCases, 'executeAppActionBatch');
            executeAppActionSpy.mockClear();
            executeAppActionBatchSpy.mockClear();

            const cases = scoredCases(corpora[corpusName]);
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

            const failed = failedAgentAcceptanceThresholds(
                metrics,
                corpusName,
                sealedScoredClasses(corpora[corpusName])
            );
            expect(failed).toEqual([]);

            executeAppActionSpy.mockRestore();
            executeAppActionBatchSpy.mockRestore();
        });
    });
});

const SEALED_LITERAL_ONLY: readonly AgentScoredPromptClass[] = ['literal-structural'];

function caseResult(
    id: string,
    expectedClass: AgentAcceptanceOutcomeClass,
    observed: AgentAcceptanceOutcomeClass,
    exactMatch: boolean,
    promptClass: AgentPromptClass = 'literal-structural'
): AgentAcceptanceCaseResult {
    return {
        id,
        class: expectedClass,
        promptClass,
        oracleKind: ORACLE_KIND_BY_CLASS[expectedClass],
        observed,
        exactMatch,
    };
}

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
        const score = (expected: AgentAcceptanceOutcomeClass, observed: AgentAcceptanceOutcomeClass, ok: boolean) =>
            scoreAgentAcceptanceCase({
                id: 'c',
                expectedClass: expected,
                promptClass: 'literal-structural',
                oracleKind: 'proposal',
                observed,
                matchesOracle: ok,
            }).exactMatch;

        expect(score('execute-exact', 'execute-exact', true)).toBe(true);
        expect(score('execute-exact', 'execute-exact', false)).toBe(false);
        expect(score('execute-exact', 'clarify-required', true)).toBe(false);
    });

    it('carries the prompt class and oracle kind the corpus declared onto the result', () => {
        expect(
            scoreAgentAcceptanceCase({
                id: 'c',
                expectedClass: 'clarify-required',
                promptClass: 'boundary',
                oracleKind: 'clarify',
                observed: 'clarify-required',
                matchesOracle: true,
            })
        ).toEqual({
            id: 'c',
            class: 'clarify-required',
            promptClass: 'boundary',
            oracleKind: 'clarify',
            observed: 'clarify-required',
            exactMatch: true,
        });
    });

    it('computes non-trivial per-class precision, recall and F1 from a mixed synthetic result set', () => {
        const results: AgentAcceptanceCaseResult[] = [
            caseResult('e1', 'execute-exact', 'execute-exact', true),
            caseResult('e2', 'execute-exact', 'execute-exact', true),
            // Misclassified: the frozen class is execute-exact, but the parser observed clarify-required.
            caseResult('e3', 'execute-exact', 'clarify-required', false),
            caseResult('c1', 'clarify-required', 'clarify-required', true, 'boundary'),
            caseResult('a1', 'abstain-unsupported', 'abstain-unsupported', true, 'boundary'),
            caseResult('d1', 'deny-policy', 'deny-policy', true, 'boundary'),
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 0);

        expect(metrics.perClass['execute-exact'].precision).toBeCloseTo(1, 5);
        expect(metrics.perClass['execute-exact'].recall).toBeCloseTo(2 / 3, 5);
        expect(metrics.perClass['execute-exact'].f1).toBeCloseTo(0.8, 5);

        expect(metrics.perClass['clarify-required'].precision).toBeCloseTo(0.5, 5);
        expect(metrics.perClass['clarify-required'].recall).toBeCloseTo(1, 5);
        expect(metrics.perClass['clarify-required'].f1).toBeCloseTo(2 / 3, 5);

        expect(metrics.exactMatchRate).toBeCloseTo(2 / 3, 5);
        expect(metrics.clarificationOnNonClarifyOracle).toBeCloseTo(1 / 5, 5);
        expect(metrics.falseAbstentionOnExecuteExact).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', SEALED_LITERAL_ONLY);
        expect(failed).toEqual(
            expect.arrayContaining([
                'execute-exact exact-match rate',
                'per-class F1: execute-exact',
                'per-class F1: clarify-required',
                'per-prompt-class execute recall: literal-structural',
                'clarify-required precision',
                'clarification on non-clarify oracles',
            ])
        );
    });

    it('scores each prompt class on its own cases rather than on the corpus average', () => {
        const results: AgentAcceptanceCaseResult[] = [
            caseResult('l1', 'execute-exact', 'execute-exact', true),
            caseResult('l2', 'execute-exact', 'execute-exact', true),
            caseResult('l3', 'execute-exact', 'execute-exact', true),
            // The device class proposes on both of its cases but matches the oracle on only one.
            caseResult('d1', 'execute-exact', 'execute-exact', true, 'device-insert-with-parameter'),
            caseResult('d2', 'execute-exact', 'execute-exact', false, 'device-insert-with-parameter'),
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 0);

        expect(metrics.perPromptClass['literal-structural']).toEqual({ recall: 1, precision: 1, support: 3 });
        expect(metrics.perPromptClass['device-insert-with-parameter']).toEqual({
            recall: 0.5,
            precision: 0.5,
            support: 2,
        });

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', [
            'literal-structural',
            'device-insert-with-parameter',
        ]);
        expect(failed).toEqual(
            expect.arrayContaining([
                'per-prompt-class execute recall: device-insert-with-parameter',
                'per-prompt-class execute precision: device-insert-with-parameter',
            ])
        );
        expect(failed).not.toContain('per-prompt-class execute recall: literal-structural');
    });

    it('reports a failing support row for every class with zero corpus cases', () => {
        const metrics = computeAgentAcceptanceMetrics([], 0);

        expect(metrics.perClass['execute-exact'].support).toBe(0);
        expect(metrics.perClass['clarify-required'].support).toBe(0);
        expect(metrics.perClass['abstain-unsupported'].support).toBe(0);
        expect(metrics.perClass['deny-policy'].support).toBe(0);
        expect(metrics.perPromptClass['literal-structural'].support).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', SEALED_LITERAL_ONLY);
        expect(failed).toEqual([
            'per-class support: execute-exact',
            'per-class support: clarify-required',
            'per-class support: abstain-unsupported',
            'per-class support: deny-policy',
            'per-prompt-class support: literal-structural',
        ]);
    });

    it('scores no row for a prompt class its corpus has not sealed', () => {
        const metrics = computeAgentAcceptanceMetrics([caseResult('l1', 'execute-exact', 'execute-exact', true)], 0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', SEALED_LITERAL_ONLY);

        expect(failed).not.toContain('per-prompt-class support: time-scoped-level');
        expect(
            failedAgentAcceptanceThresholds(metrics, 'development', ['literal-structural', 'time-scoped-level'])
        ).toContain('per-prompt-class support: time-scoped-level');
    });

    it('counts per-class support from the frozen class label, never the observed outcome', () => {
        // A single case whose corpus label disagrees with what the parser produced: support must
        // still credit the frozen class (execute-exact), not the class the run happened to land in
        // (deny-policy) — a misclassified case is still one covered corpus case, not zero coverage
        // of its own class and spurious coverage of another.
        const results: AgentAcceptanceCaseResult[] = [caseResult('e1', 'execute-exact', 'deny-policy', false)];

        const metrics = computeAgentAcceptanceMetrics(results, 0);
        expect(metrics.perClass['execute-exact'].support).toBe(1);
        expect(metrics.perClass['deny-policy'].support).toBe(0);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', SEALED_LITERAL_ONLY);
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
            caseResult('e1', 'execute-exact', 'execute-exact', true),
            caseResult('e2', 'execute-exact', 'execute-exact', true),
            caseResult('e3', 'execute-exact', 'execute-exact', true),
            caseResult('c1', 'clarify-required', 'clarify-required', true, 'boundary'),
            caseResult('a1', 'abstain-unsupported', 'abstain-unsupported', true, 'boundary'),
            caseResult('d1', 'deny-policy', 'deny-policy', true, 'boundary'),
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 3);
        expect(metrics.unintendedMutations).toBe(3);

        const failed = failedAgentAcceptanceThresholds(metrics, 'development', SEALED_LITERAL_ONLY);
        expect(failed).toEqual(['safety: unintended-mutation count']);
    });

    it('trips every frozen threshold row, in the documented order, from one adversarial result set', () => {
        const results: AgentAcceptanceCaseResult[] = [
            caseResult('e1', 'execute-exact', 'clarify-required', false),
            caseResult('e2', 'execute-exact', 'abstain-unsupported', false),
            caseResult('e3', 'execute-exact', 'execute-exact', false),
            caseResult('c1', 'clarify-required', 'clarify-required', true, 'boundary'),
            caseResult('d1', 'deny-policy', 'deny-policy', true, 'boundary'),
            caseResult('d2', 'deny-policy', 'abstain-unsupported', false, 'boundary'),
            caseResult('a1', 'abstain-unsupported', 'abstain-unsupported', true, 'boundary'),
            caseResult('a2', 'abstain-unsupported', 'deny-policy', false, 'boundary'),
        ];

        const metrics = computeAgentAcceptanceMetrics(results, 3);
        const failed = failedAgentAcceptanceThresholds(metrics, 'development', [
            'literal-structural',
            'time-scoped-level',
        ]);

        expect(failed).toEqual([
            'safety: unintended-mutation count',
            'deny-policy recall',
            'abstain-unsupported recall on deferred capabilities',
            'execute-exact exact-match rate',
            'per-class F1: execute-exact',
            'per-class F1: clarify-required',
            'per-class F1: abstain-unsupported',
            'per-class F1: deny-policy',
            'per-prompt-class execute recall: literal-structural',
            'per-prompt-class execute precision: literal-structural',
            'per-prompt-class support: time-scoped-level',
            'clarify-required precision',
            'clarification on non-clarify oracles',
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

    it('returns false when the oracle pins a different array length', () => {
        const actual = { notes: [{ pitch: 60 }, { pitch: 62 }, { pitch: 64 }] };

        expect(payloadMatches(actual, { notes: [{ pitch: 60 }, { pitch: 62 }] })).toBe(false);
        expect(payloadMatches(actual, { notes: [{ pitch: 60 }, { pitch: 62 }, { pitch: 999 }] })).toBe(false);
    });

    it('throws naming the indexed path when a record inside an array names no fields', () => {
        const throwsFromNestedHollowRecord = () => payloadMatches({ notes: [{ pitch: 60 }] }, { notes: [{}] });

        expect(throwsFromNestedHollowRecord).toThrow(/payload\.notes\[0\]/);
        expect(throwsFromNestedHollowRecord).toThrow(/names no fields to pin/);
    });
});

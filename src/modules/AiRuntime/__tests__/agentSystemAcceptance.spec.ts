import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { change, clone, Counter, toJS } from '@automerge/automerge';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import * as commandUseCases from '#/modules/Command/useCases';
import * as crdtDocumentUseCases from '#/modules/CrdtDocument/useCases';
import {
    createCrdtDoc,
    createCommandPreviewWorkspace,
    captureProjectRevision,
    getCrdtDoc,
    getCrdtDocIds,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { parseSemanticProjectQueryInput, querySemanticProject } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore, type TransportState } from '#/modules/Transport/stores';
import { restoreTransportSnapshot } from '#/modules/Transport/useCases';
import { clampFaderGain, resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

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
import { type AgentPlanProposal } from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type PlanningOutcome } from '../models/PlanningOutcome';
import { type ProjectContext } from '../models/ProjectContext';
import {
    classifyPlanningOutcome,
    computeAgentAcceptanceMetrics,
    failedAgentAcceptanceThresholds,
    scoreAgentAcceptanceCase,
} from '../services/agentAcceptanceScorer';
import { clearAiHistory } from '../stores/aiActionHistoryStore';
import { chatStore } from '../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
    proposePendingActionConfirmation,
} from '../stores/pendingActionConfirmationStore';
import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from '../useCases/__tests__/aiWorkflowCommandPreflightFixture';
import { advertisedAnswerIntake } from '../useCases/__tests__/answerWireFixture';
import {
    assertDiscoveredCommandSchemas,
    declineCall,
    discoverSearchedCalls,
    isRecord,
    proposeCall,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    searchCalls,
    type ProviderCall,
    type ScriptedTurn,
} from '../useCases/__tests__/highLevelIntentWorkflowFixture';
import { literalMetricIntakeTurn } from '../useCases/__tests__/metricGoalWorkflowFixture';
import { GENERATED_BATCH_LOCAL_ID_PREFIXES } from '../useCases/agentReference/batchLocalBindingProducers';
import { confirmPendingChatActions } from '../useCases/confirmPendingChatActions';
import { getPlannedActionAffectedIds } from '../useCases/getPlannedActionAffectedIds';
import { getProjectContext } from '../useCases/getProjectContext';
import { parsePromptToActions } from '../useCases/parsePromptToActions';
import { type planPromptActions } from '../useCases/planPromptActions';
import { readChatThreadContext } from '../useCases/readChatThreadContext';
import { sendChatMessage } from '../useCases/sendChatMessage';

import { completeAcceptanceResults, createAcceptanceFixtureLifetime } from './acceptanceFixtureLifetime';

type PlannedChatRequest = Awaited<ReturnType<typeof planPromptActions>>['result'];

const runtimeMocks = vi.hoisted(() => ({
    generateWebLlmCompletion: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

/** What the chat route planned for the request it last sent, read where the route itself reads it. */
const chatPlanning = vi.hoisted(() => ({ last: null as PlannedChatRequest | null }));

vi.mock('../useCases/planPromptActions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../useCases/planPromptActions')>();
    return {
        ...actual,
        planPromptActions: async (input: Parameters<typeof actual.planPromptActions>[0]) => {
            const planned = await actual.planPromptActions(input);
            chatPlanning.last = planned.result;
            return planned;
        },
    };
});

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

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
}));

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..');

const CORPORA_DIRECTORY = 'evidence/agent-campaign/corpora';

const CORPUS_PATHS: Record<AgentAcceptanceCorpusName, string> = {
    development: `${CORPORA_DIRECTORY}/development.json`,
    'held-out': `${CORPORA_DIRECTORY}/held-out.json`,
};

const THRESHOLDS_DOC_PATH = 'docs/architecture/agent-release-gates.md';

/** The file name both corpora must name, so one project answers every case in both of them. */
const FIXTURE_PROJECT_FILE = 'fixture-project.json';

/** The identity the fixture project is opened under when a question queries it. */
const FIXTURE_PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

/** The outcome classes the `boundary` prompt class exists to hold, each needing a case of its own. */
const BOUNDARY_OUTCOME_CLASSES: readonly AgentAcceptanceOutcomeClass[] = [
    'clarify-required',
    'abstain-unsupported',
    'deny-policy',
];

/** A whole corpus runs in one test, its refinement cases through the chat route twice each. */
const CORPUS_RUN_TIMEOUT_MS = 60_000;

/** How many cases a sealed scored prompt class must carry before its floors mean anything. */
const MINIMUM_SEALED_CLASS_CASES = 3;

/**
 * A local, minimal type for the corpus files: nothing under `src/` may import from `scripts/`, so
 * this spec reads the corpus JSON structurally rather than sharing a type with the evidence-gate
 * generator.
 */
type CorpusProviderTurn =
    | { kind: 'intake'; intent: 'literal' | 'answer' }
    | { kind: 'search'; intents: string[] }
    | { kind: 'discover'; names: string[] }
    | { kind: 'propose'; items: Record<string, unknown>[]; plan?: AgentPlanProposal }
    | ProposeCommandsTurn
    | { kind: 'decline'; args: Record<string, unknown> }
    | { kind: 'query' | 'answer'; id: string; args: Record<string, unknown> };

/**
 * A proposal of plain commands, the form whose card carries the grounding basis a terse refinement
 * inherits from. `refinesPriorProposal` names the card the prior turn left pending: its confirmation
 * id is application-minted, so the runner reads it from the live thread rather than the corpus
 * pinning it.
 */
type ProposeCommandsTurn = {
    kind: 'propose-commands';
    commands: Array<{ name: string; arguments: Record<string, unknown> }>;
    refinesPriorProposal?: true;
};

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
    | AnswerOracle
    | {
          kind: 'proposal';
          actions: CorpusOracleAction[];
          invariants?: CorpusOracleInvariants;
          /** A refinement's replacement: the batch must supersede the card the prior turn left pending. */
          replaces?: 'prior-proposal';
      }
    | { kind: 'revert'; group: 'prior-commit' }
    | { kind: 'clarify' }
    | { kind: 'unsupported' }
    | { kind: 'denied' }
    | { kind: 'pending' };

/** The five follow-ups a refinement case answers: two against a pending card, three against a commit. */
const REFINEMENT_KINDS = [
    'scale-pending',
    'exclude-pending',
    'relative-to-commit',
    'undo-commit',
    'retarget-commit',
] as const;

type RefinementKind = (typeof REFINEMENT_KINDS)[number];

/** What the prior turn of each kind must leave behind for the follow-up to mean anything. */
const PRIOR_OUTCOME_BY_KIND: Record<RefinementKind, CorpusPriorTurn['outcome']> = {
    'scale-pending': 'pending',
    'exclude-pending': 'pending',
    'relative-to-commit': 'committed',
    'undo-commit': 'committed',
    'retarget-commit': 'committed',
};

/**
 * The turn a refinement follows: its request, its scripted provider turns, and what it must leave
 * behind — a card awaiting confirmation, or a batch committed through the real batch path (the
 * runner confirms the card where the risk policy holds one for approval, as the musician would).
 */
type CorpusPriorTurn = {
    prompt: string;
    providerTurns: readonly CorpusProviderTurn[];
    outcome: 'pending' | 'committed';
};

type CorpusCase = {
    id: string;
    promptClass: AgentPromptClass;
    class: AgentAcceptanceOutcomeClass;
    prompt: string;
    providerTurns: readonly CorpusProviderTurn[];
    oracle: CorpusOracle;
    /** A `refinement` case only: which follow-up it is, and the turn it follows. */
    refinementKind?: RefinementKind;
    prior?: CorpusPriorTurn;
    /** Explicit musician edits between a committed prior and its continuation. */
    interveningFaderEdits?: readonly { trackId: string; gainDb: number }[];
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

function corpusCase(corpusName: AgentAcceptanceCorpusName, id: string): CorpusCase {
    const testCase = corpora[corpusName].cases.find((entry) => entry.id === id);
    if (testCase === undefined) {
        throw new Error(`The ${corpusName} corpus holds no case ${id}`);
    }
    return testCase;
}

/** The one project every case in both corpora plans against, read from the file the corpora name. */
const context: ProjectContext = JSON.parse(
    readFileSync(resolve(REPOSITORY_ROOT, CORPORA_DIRECTORY, FIXTURE_PROJECT_FILE), 'utf8')
) as ProjectContext;

const GENERATED_ID_PREFIXES: readonly string[] = Object.values(GENERATED_BATCH_LOCAL_ID_PREFIXES);

/** An id this batch minted, rather than one it took from the project snapshot. */
function isBatchMintedId(id: string): boolean {
    return GENERATED_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Every request a case sends: a refinement's prior turn as well as its follow-up. */
function casePrompts(testCase: CorpusCase): string[] {
    return testCase.prior === undefined ? [testCase.prompt] : [testCase.prior.prompt, testCase.prompt];
}

/** The shape of oracle a refinement case declares: a pending card's replacement, a batch, or an undo. */
type RefinementOracleShape = 'replacement' | 'batch' | 'revert';

/**
 * The oracle each refinement kind answers with: a pending card's replacement, the compiled batch on
 * top of a commit, or the commit's undo.
 */
const REFINEMENT_ORACLE_SHAPE: Record<RefinementKind, RefinementOracleShape> = {
    'scale-pending': 'replacement',
    'exclude-pending': 'replacement',
    'relative-to-commit': 'batch',
    'undo-commit': 'revert',
    'retarget-commit': 'batch',
};

function refinementOracleShape(oracle: CorpusOracle): RefinementOracleShape | null {
    if (oracle.kind === 'revert') {
        return 'revert';
    }
    if (oracle.kind !== 'proposal') {
        return null;
    }
    return oracle.replaces === 'prior-proposal' ? 'replacement' : 'batch';
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

/**
 * The plain-command proposal a scripted provider sends, in the shape the refinement specs drive the
 * chat route with: the plan's scope is every track a command names.
 */
function commandBatchProposal(turn: ProposeCommandsTurn, refines: string | undefined): ProviderCall {
    const targetIds = [...new Set(turn.commands.flatMap((command) => [command.arguments.trackId].filter(isString)))];
    const proposal: ProviderCall = {
        name: 'command.batch.propose',
        arguments: {
            commands: turn.commands.map((command) => ({ name: command.name, arguments: command.arguments })),
            plan: {
                semantic: { classification: 'simple', uncertainty: [] },
                objective: 'Apply the exact requested mix changes.',
                constraints: [],
                scope: {
                    targetIds,
                    targetRanges: [],
                    protectedTargetIds: [],
                    protectedRanges: [],
                },
                capabilityIds: [...new Set(turn.commands.map((command) => command.name))],
                assetIds: [],
                alternatives: [],
                validationStrategy: ['Validate exact track identities and values.'],
                stoppingConditions: ['Stop if any target precondition fails.'],
            },
        },
    };
    if (refines !== undefined) {
        proposal.arguments.refines = refines;
    }
    return proposal;
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

/**
 * A descriptive question's intake: the project-facts answer branch of the interpretation selector the
 * provider was actually offered, read from its advertised schema rather than restated here.
 */
const answerIntakeTurn: ScriptedTurn = (_userMessage, providerView) => [advertisedAnswerIntake(providerView)];

/**
 * Maps one corpus-declared provider turn to the same scripted-turn builders the workflow fixture
 * proves against production. `priorProposalId` reads the card a refinement names in `refines`.
 */
function toScriptedTurn(
    turn: CorpusProviderTurn,
    priorProposalId: () => string | undefined = () => undefined
): ScriptedTurn {
    switch (turn.kind) {
        case 'intake':
            if (turn.intent === 'literal') {
                return literalMetricIntakeTurn;
            }
            if (turn.intent === 'answer') {
                return answerIntakeTurn;
            }
            throw new TypeError('The corpus intake variant has no configured producer.');
        case 'search':
            return () => searchCalls(turn.intents);
        case 'discover':
            return discoverSearchedCalls(turn.names);
        case 'propose': {
            const names = [...new Set(turn.items.map((item) => String(item.name)))];
            return proposeDiscoveredCalls(turn.items, names, turn.plan);
        }
        case 'propose-commands': {
            const names = [...new Set(turn.commands.map((command) => command.name))];
            return (userMessage) => {
                assertDiscoveredCommandSchemas(userMessage, names);
                const refines = turn.refinesPriorProposal === true ? priorProposalId() : undefined;
                if (turn.refinesPriorProposal === true && refines === undefined) {
                    throw new Error('A refining proposal names a prior card the thread does not hold.');
                }
                return [commandBatchProposal(turn, refines)];
            };
        }
        case 'decline':
            return () => [declineCall(turn.args)];
        case 'query':
        case 'answer': {
            const call = {
                id: turn.id,
                name: turn.kind === 'query' ? 'project.query' : 'answer.respond',
                arguments: turn.args,
            };
            return () => [call];
        }
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
    'answer-exact': 'answer',
    'clarify-required': 'clarify',
    'abstain-unsupported': 'unsupported',
    'deny-policy': 'denied',
};

/** An executed change is either a compiled batch or the undo of the last commit, which carries none. */
const EXECUTE_ORACLE_KINDS: readonly AgentAcceptanceOracleKind[] = ['proposal', 'revert'];

function assertOracleKindFitsClass(testCase: CorpusCase): void {
    const admitted = testCase.class === 'execute-exact' ? EXECUTE_ORACLE_KINDS : [ORACLE_KIND_BY_CLASS[testCase.class]];
    expect(
        admitted,
        `Case ${testCase.id} declares oracle.kind='${testCase.oracle.kind}' for class='${testCase.class}'`
    ).toContain(testCase.oracle.kind);
}

type PlannedActions = Awaited<ReturnType<typeof parsePromptToActions>>['actions'];

/** One scored case and the writes it made that its oracle never asked for. */
type CaseRun = { result: AgentAcceptanceCaseResult; unintendedMutations: number };

type ProjectTruth = Record<string, Record<string, unknown>>;
type ProjectObservation = { kind: 'full' | 'root'; truth: ProjectTruth };

/** Materialized project values, independent of the route that wrote them. */
function materializeProjectTruth(): ProjectTruth {
    const truth: ProjectTruth = {};
    for (const id of getCrdtDocIds()) {
        const document = getCrdtDoc(id);
        if (document === undefined) {
            continue;
        }
        const value: unknown = toJS(document);
        if (!isRecord(value)) {
            throw new TypeError(`The acceptance project document ${id} has no object value.`);
        }
        if (id === 'root') {
            // Checkpoint bookkeeping changes with valid commits but carries no project content.
            delete value.commandBatchIdempotency;
        }
        truth[id] = value;
    }
    return truth;
}

function captureProjectTruth(): ProjectTruth {
    captureSettledRevision();
    return materializeProjectTruth();
}

function materializeInstalledRoot(document: ReturnType<typeof getCrdtDoc>): ProjectTruth {
    if (document === undefined) {
        return {};
    }
    const value: unknown = toJS(document);
    if (!isRecord(value)) {
        throw new TypeError('The acceptance active root has no object value.');
    }
    delete value.commandBatchIdempotency;
    return { root: value };
}

/** Capture applied CRDT content without settling from inside a repository notification. */
async function observeProjectChanges<T>(
    run: () => Promise<T>,
    materialize: () => ProjectTruth = materializeProjectTruth,
    materializeRoot: (document: ReturnType<typeof getCrdtDoc>) => ProjectTruth = materializeInstalledRoot
): Promise<{ result: T; transitions: ProjectTruth[]; observations: ProjectObservation[] }> {
    const transitions: ProjectTruth[] = [];
    const observations: ProjectObservation[] = [];
    let failure: Error | undefined;
    const unsubscribeChanges = crdtDocumentUseCases.subscribeToCrdtChanges(() => {
        try {
            const truth = materialize();
            transitions.push(truth);
            observations.push({ kind: 'full', truth });
        } catch (error) {
            failure ??= error instanceof Error ? error : new Error('Project truth capture failed.', { cause: error });
        }
    });
    let unsubscribeRoot: () => void;
    try {
        unsubscribeRoot = crdtDocumentUseCases.subscribeToActiveRootInstallations((installation) => {
            if (installation.kind === 'reset') {
                failure ??= new Error('Acceptance project reset during observation.');
                return;
            }
            try {
                observations.push({ kind: 'root', truth: materializeRoot(installation.document) });
            } catch (error) {
                failure ??= error instanceof Error ? error : new Error('Active root capture failed.', { cause: error });
            }
        });
    } catch (error) {
        unsubscribeChanges();
        throw error;
    }
    let result: T;
    try {
        result = await run();
        captureSettledRevision();
    } finally {
        unsubscribeChanges();
        unsubscribeRoot();
    }
    if (failure !== undefined) {
        throw failure;
    }
    return { result, transitions, observations };
}

/** Every applied state must match one oracle-authorized prefix. */
function transitionDifferences(transitions: readonly ProjectTruth[], allowed: readonly ProjectTruth[]): number {
    let earliest = 0;
    let differences = 0;
    for (const transition of transitions) {
        const remaining = allowed.slice(earliest);
        const counts = remaining.map((state) => projectDifferences(state, transition));
        const nearest = Math.min(...counts);
        differences = Math.max(differences, nearest);
        if (nearest === 0) {
            earliest += counts.indexOf(0);
        }
    }
    return differences;
}

function observedDifferences(
    observed: { observations: readonly ProjectObservation[] },
    allowed: readonly ProjectTruth[]
): number {
    const allowedRoots = allowed.map((state): ProjectTruth => {
        if (state.root === undefined) {
            return {};
        }
        return { root: state.root };
    });
    let earliest = 0;
    let differences = 0;
    for (const observation of observed.observations) {
        const states = observation.kind === 'root' ? allowedRoots : allowed;
        const counts = states.slice(earliest).map((state) => projectDifferences(state, observation.truth));
        const nearest = Math.min(...counts);
        differences = Math.max(differences, nearest);
        if (nearest === 0) {
            earliest += counts.indexOf(0);
        }
    }
    return differences;
}

function commitPrefixes(before: ProjectTruth, actions: readonly CorpusOracleAction[]): ProjectTruth[] {
    return Array.from({ length: actions.length + 1 }, (_, index) =>
        projectAfterOracleActions(before, actions.slice(0, index))
    );
}

function undoPrefixes(
    beforeCommit: ProjectTruth,
    beforeUndo: ProjectTruth,
    actions: readonly CorpusOracleAction[]
): ProjectTruth[] {
    const committedPrefixes = commitPrefixes(beforeCommit, actions);
    const states = [beforeUndo];
    let current = beforeUndo;
    for (let index = actions.length - 1; index >= 0; index--) {
        const prior = committedPrefixes[index];
        const action = actions[index];
        if (prior === undefined || action === undefined) {
            throw new Error('Missing undo oracle prefix.');
        }
        current = projectAfterOracleUndo(prior, current, [action]);
        states.push(current);
    }
    return states;
}

function isProjectMap(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** Count differing leaves; adding or removing a whole subtree counts at least once. */
function projectDifferences(expected: unknown, actual: unknown): number {
    if (isDeepStrictEqual(expected, actual)) {
        return 0;
    }
    if (Array.isArray(expected) && Array.isArray(actual)) {
        let count = 0;
        for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
            count += projectDifferences(expected[index], actual[index]);
        }
        return count;
    }
    if (isProjectMap(expected) && isProjectMap(actual)) {
        if (Object.getPrototypeOf(expected) !== Object.getPrototypeOf(actual)) {
            return 1;
        }
        let count = 0;
        for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
            count += projectDifferences(expected[key], actual[key]);
        }
        return count;
    }
    return 1;
}

/**
 * The sealed refinement commits currently authorize only gain and mute fields. Fail closed when a future
 * case adds another operation: its permitted project transition needs an explicit oracle too.
 */
function projectAfterOracleActions(before: ProjectTruth, actions: readonly CorpusOracleAction[]): ProjectTruth {
    const root = before.root;
    const trackSlot = root?.tracks;
    if (root === undefined || !isProjectMap(trackSlot) || !Array.isArray(trackSlot.tracks)) {
        throw new TypeError('The acceptance project has no materialized track collection.');
    }
    // Copy only the fields the oracle will edit; cloning a Counter as a plain object changes its type.
    const tracks = trackSlot.tracks.map((track) => {
        if (!isProjectMap(track)) {
            throw new TypeError('An acceptance track must be a project map.');
        }
        return track;
    });
    const expected = { ...before, root: { ...root, tracks: { ...trackSlot, tracks } } };
    for (const action of actions) {
        if (!['setTrackGain', 'muteTrack'].includes(action.type) || typeof action.payload.trackId !== 'string') {
            throw new TypeError(`Refinement project oracle does not cover ${action.type}.`);
        }
        const trackIndex = tracks.findIndex((candidate) => candidate.id === action.payload.trackId);
        const track = tracks[trackIndex];
        if (!isRecord(track) || typeof track.gain !== 'number') {
            throw new TypeError(`The acceptance project has no fader for ${action.payload.trackId}.`);
        }
        if (action.type === 'muteTrack') {
            if (typeof action.payload.muted !== 'boolean') {
                throw new TypeError('A mute oracle value must be boolean.');
            }
            tracks[trackIndex] = { ...track, muted: action.payload.muted };
            continue;
        }
        const { gain, gainDb, deltaDb } = action.payload;
        for (const value of [gain, gainDb, deltaDb]) {
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
                throw new TypeError('A fader oracle level must be finite.');
            }
        }
        const level = resolveLevelFields(
            {
                linear: typeof gain === 'number' ? gain : undefined,
                absoluteDb: typeof gainDb === 'number' ? gainDb : undefined,
                deltaDb: typeof deltaDb === 'number' ? deltaDb : undefined,
            },
            track.gain,
            TRACK_FADER_LAW
        );
        if (!level.ok) {
            throw new Error('The acceptance fader oracle declares an invalid level.');
        }
        tracks[trackIndex] = { ...track, gain: clampFaderGain(level.linear) };
    }
    return expected;
}

/** Undo restores only the fields authorized by the prior commit, atop the current project. */
function projectAfterOracleUndo(
    beforeCommit: ProjectTruth,
    beforeUndo: ProjectTruth,
    actions: readonly CorpusOracleAction[]
): ProjectTruth {
    // Validate every operation and its original field before deriving an inverse.
    projectAfterOracleActions(beforeCommit, actions);
    const trackSlot = beforeCommit.root?.tracks;
    if (!isProjectMap(trackSlot) || !Array.isArray(trackSlot.tracks)) {
        throw new TypeError('The acceptance project has no materialized track collection.');
    }
    const tracks = trackSlot.tracks;
    const inverses = actions.toReversed().map((action) => {
        const track = tracks.find(
            (candidate: unknown) => isProjectMap(candidate) && candidate.id === action.payload.trackId
        );
        if (!isProjectMap(track)) {
            throw new TypeError('The acceptance project has no original track value.');
        }
        if (action.type === 'muteTrack') {
            if (typeof track.muted !== 'boolean') {
                throw new TypeError('The acceptance project has no original boolean mute value.');
            }
            return { type: action.type, payload: { trackId: action.payload.trackId, muted: track.muted } };
        }
        if (typeof track.gain !== 'number' || !Number.isFinite(track.gain)) {
            throw new TypeError('The acceptance project has no original finite fader value.');
        }
        return { type: action.type, payload: { trackId: action.payload.trackId, gain: track.gain } };
    });
    return projectAfterOracleActions(beforeUndo, inverses);
}

/** The prior's frozen scripted commands declare the setup a committed refinement may establish. */
function priorCommitOracleActions(prior: CorpusPriorTurn): CorpusOracleAction[] {
    const proposals = prior.providerTurns.filter((turn) => turn.kind === 'propose-commands');
    if (proposals.length !== 1) {
        throw new Error('A committed refinement prior needs one frozen command proposal for its project oracle.');
    }
    return proposals[0]!.commands.map((command) => ({ type: command.name, payload: command.arguments }));
}

/** An action as the stores and the Command barrel hold it: its type, and its payload when it has one. */
type LandedAction = { type: string; payload?: unknown };

/** Where the Command barrel's two spies stood when a turn began. */
type BarrelMark = { single: number; batch: number };

/**
 * The Command barrel writes a corpus run has asked for, through the spies on `executeAppAction` and
 * `executeAppActionBatch`: a call count for the single-turn cases, and the actions themselves for a
 * refinement turn, which must tell its own commit's entries from any other write.
 */
type BarrelWriteLog = {
    count: () => number;
    mark: () => BarrelMark;
    actionsSince: (mark: BarrelMark) => LandedAction[];
};

function spyOnBarrelWrites(): { log: BarrelWriteLog; restore: () => void } {
    const single = vi.spyOn(commandUseCases, 'executeAppAction');
    const batch = vi.spyOn(commandUseCases, 'executeAppActionBatch');
    single.mockClear();
    batch.mockClear();
    return {
        log: {
            count: () => single.mock.calls.length + batch.mock.calls.length,
            mark: () => ({ single: single.mock.calls.length, batch: batch.mock.calls.length }),
            actionsSince: (mark) => [
                ...single.mock.calls.slice(mark.single).map(([action]) => action),
                ...batch.mock.calls.slice(mark.batch).flatMap(([actions]) => [...actions]),
            ],
        },
        restore: () => {
            single.mockRestore();
            batch.mockRestore();
        },
    };
}

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
async function runCorpusCase(
    testCase: CorpusCase,
    barrel: BarrelWriteLog,
    alongside?: () => Promise<void>
): Promise<CaseRun> {
    if (testCase.promptClass === 'refinement') {
        return runRefinementCase(testCase, barrel);
    }
    if (testCase.oracle.kind !== 'answer') {
        return runSingleTurnCase(testCase, barrel, alongside);
    }
    // `project.query` reads the open project, so a question is asked of the fixture project loaded
    // into the real stores and document, under a canonical identity a semantic query can answer for.
    const projectBefore = projectStore.value;
    openChatProject();
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        projectId: FIXTURE_PROJECT_ID,
        initialized: true,
        loading: false,
    });
    try {
        return await runSingleTurnCase(testCase, barrel, alongside);
    } finally {
        projectStore.set(projectBefore);
        closeChatProject();
    }
}

async function runSingleTurnCase(
    testCase: CorpusCase,
    barrel: BarrelWriteLog,
    alongside?: () => Promise<void>
): Promise<CaseRun> {
    const writesBefore = barrel.count();
    const projectBefore = captureProjectTruth();
    const observed = await observeProjectChanges(async () => {
        const result = await runPlannedCorpusCase(testCase);
        await alongside?.();
        return { result, projectAfter: captureProjectTruth() };
    });
    const unintendedMutations = Math.max(
        barrel.count() - writesBefore,
        projectDifferences(projectBefore, observed.result.projectAfter),
        observedDifferences(observed, [projectBefore])
    );
    const result = observed.result.result;
    return {
        result: result.class === 'answer-exact' && unintendedMutations > 0 ? { ...result, exactMatch: false } : result,
        unintendedMutations,
    };
}

/** Plans one single-turn case against the fixture project, with no thread and no chat route. */
async function runPlannedCorpusCase(testCase: CorpusCase): Promise<AgentAcceptanceCaseResult> {
    expect(
        testCase.oracle.kind,
        `Case ${testCase.id} declares oracle.kind='${testCase.oracle.kind}' for class='${testCase.class}'`
    ).toBe(ORACLE_KIND_BY_CLASS[testCase.class]);

    runtimeMocks.generateWebLlmCompletion.mockReset();
    if (testCase.providerTurns.length > 0) {
        scriptProviderTurns(
            runtimeMocks.generateWebLlmCompletion,
            testCase.providerTurns.map((turn) => toScriptedTurn(turn))
        );
    }
    const projectRevision = testCase.oracle.kind === 'answer' ? captureSettledRevision() : `revision-${testCase.id}`;
    const result = await parsePromptToActions({
        prompt: testCase.prompt,
        context,
        projectRevision,
    });

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
    if (testCase.oracle.kind === 'answer') {
        matchesOracle = answerMatchesOracle({
            oracle: parseAnswerOracle(testCase.oracle),
            outcome: result.planningOutcome,
            actions: result.actions,
            receipts: result.applicationToolReceipts ?? [],
            projectId: projectStore.value?.projectId ?? null,
            projectRevision,
        });
    }
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

function readStoreTrackKind(kind: string): Track['kind'] {
    if (kind === 'audio' || kind === 'midi' || kind === 'bus') {
        return kind;
    }
    throw new Error(`The fixture project holds a track kind the chat project cannot load: ${kind}`);
}

/** One fixture-project track as the arrangement store holds it, so the chat route reads the same project. */
function toStoreTrack(track: ProjectContext['tracks'][number]): Track {
    return {
        id: track.id,
        name: track.name,
        kind: readStoreTrackKind(track.kind),
        muted: track.muted,
        soloed: track.soloed,
        armed: track.armed,
        gain: track.gain,
        pan: track.pan,
        color: '#ffffff',
        clips: [],
        devices: track.devices.map((device) => ({
            id: device.id,
            name: device.name ?? device.type,
            type: device.type,
            bypassed: device.bypassed,
            parameterValues: Object.fromEntries(
                (device.parameters ?? []).map((parameter) => [parameter.id, parameter.value])
            ),
        })),
        sends: (track.sends ?? []).map((send) => ({ busId: send.busId, level: send.level, preFader: send.preFader })),
        midiFx: [],
        frozen: track.frozen ?? false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: track.automationMode,
        groupId: null,
        soloSafe: track.soloSafe,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

/**
 * The transport slice of a project context as the transport store holds it. The store keeps master
 * gain on a 0–100 scale where the context carries linear gain, the inverse of `getProjectContext`.
 */
function toTransportSnapshot(fixture: ProjectContext): TransportState {
    return {
        ...defaultTransportState,
        tempo: fixture.tempo,
        timeSignatureNumerator: fixture.timeSignature[0],
        timeSignatureDenominator: fixture.timeSignature[1],
        isPlaying: fixture.isPlaying,
        isRecording: fixture.isRecording,
        isLooping: fixture.isLooping,
        loopStart: fixture.loopStart,
        loopEnd: fixture.loopEnd,
        punchInEnabled: fixture.punchInEnabled,
        punchInBeat: fixture.punchInBeat,
        punchOutBeat: fixture.punchOutBeat,
        metronomeEnabled: fixture.metronomeEnabled,
        metronomeVolume: fixture.metronomeVolume,
        masterGain: fixture.masterGain * 100,
    };
}

/**
 * Opens the fixture project as the chat sees it — real stores, Command and CRDT document, as the
 * refinement specs drive the chat route — with an empty thread and an empty undo history. Its
 * transport comes from the fixture through the app's own project-load route, so a query that reads
 * the transport store answers for the fixture rather than for the store defaults.
 */
function openChatProject(fixture: ProjectContext = context): void {
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('agent acceptance refinement case');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    commandUseCases.clearUndoHistory();
    commandUseCases.resetActionReplayAuthority();
    commandUseCases.setActionHistoryMetadataPort({
        record: () => [],
        markReverted: () => ({ status: 'unavailable' as const }),
        clear: () => undefined,
    });
    clearAiHistory();
    clearPendingActionConfirmations();
    setArrangementEventBus({ emit: () => Promise.resolve() });
    setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
    macroStore.set({ macros: [], recording: false, currentRecording: [] });
    trackStore.set({ tracks: fixture.tracks.map(toStoreTrack), selectedTrackId: null, ghostClips: [] });
    automationStore.set({ lanes: [] });
    transportStore.set(defaultTransportState);
    restoreTransportSnapshot(toTransportSnapshot(fixture));
    chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
}

function closeChatProject(): void {
    commandUseCases.clearUndoHistory();
    resetAiWorkflowCommandPreflightFixture();
    commandUseCases.resetActionReplayAuthority();
    clearHandlerRegistry();
    clearAiHistory();
    clearPendingActionConfirmations();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    automationStore.set({ lanes: [] });
    transportStore.set(defaultTransportState);
    chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
}

function proposedConfirmationIds(): string[] {
    return (pendingActionConfirmationStore.value?.confirmations ?? [])
        .filter((confirmation) => confirmation.status === 'proposed')
        .map((confirmation) => confirmation.id);
}

function lastAssistantReply(): string {
    const message = chatStore.value?.messages.findLast((candidate) => candidate.role === 'assistant');
    return `${message?.content ?? ''} ${message?.error ?? ''}`.trim();
}

function captureSettledRevision(): string {
    flushAutomergeStorageWrites();
    return settlePendingProjectWritesAndCaptureRevision();
}

/**
 * What one chat turn wrote: the actions it asked the Command barrel for, whether the project or its
 * undo history moved by any route, and the undo groups it added.
 */
type ChatTurnWrites = {
    barrelActions: LandedAction[];
    moved: boolean;
    newGroups: PastEntry[][];
    projectBefore: ProjectTruth;
    projectAfter: ProjectTruth;
    transitions: ProjectTruth[];
    observations: ProjectObservation[];
};

/** A write the turn made, counted once even where only the project revision shows it. */
function anyWrites(writes: ChatTurnWrites): number {
    return Math.max(
        writes.barrelActions.length,
        writes.moved ? 1 : 0,
        projectDifferences(writes.projectBefore, writes.projectAfter),
        observedDifferences(writes, [writes.projectBefore])
    );
}

type PastEntry = NonNullable<typeof undoHistoryStore.value>['past'][number];

function pastEntries(): readonly PastEntry[] {
    return undoHistoryStore.value?.past ?? [];
}

/**
 * The undo groups the entries `before` did not hold make, in order; an entry outside any group is a
 * group of its own. The history keeps its entries by reference, so the ones a turn added are the
 * ones absent from where it began.
 */
function groupsAddedSince(before: ReadonlySet<PastEntry>): PastEntry[][] {
    const groups = new Map<PastEntry | string, PastEntry[]>();
    for (const entry of pastEntries()) {
        if (before.has(entry)) {
            continue;
        }
        const key = entry.groupId ?? entry;
        const group = groups.get(key);
        if (group === undefined) {
            groups.set(key, [entry]);
            continue;
        }
        group.push(entry);
    }
    return [...groups.values()];
}

/**
 * Sends one chat turn with its own scripted provider turns and returns what it wrote. `alongside`
 * runs inside the turn, after the chat route returns and before its writes are read, so a self-check
 * can make the turn write what no oracle names.
 */
async function sendScriptedChatTurn(input: {
    id: string;
    prompt: string;
    providerTurns: readonly CorpusProviderTurn[];
    priorProposalId: () => string | undefined;
    barrel: BarrelWriteLog;
    alongside?: () => Promise<void>;
}): Promise<ChatTurnWrites> {
    runtimeMocks.generateWebLlmCompletion.mockReset();
    if (input.providerTurns.length > 0) {
        scriptProviderTurns(
            runtimeMocks.generateWebLlmCompletion,
            input.providerTurns.map((turn) => toScriptedTurn(turn, input.priorProposalId))
        );
    }
    chatPlanning.last = null;
    const revision = captureSettledRevision();
    const projectBefore = captureProjectTruth();
    const pastLength = pastEntries().length;
    const entriesBefore = new Set(pastEntries());
    const mark = input.barrel.mark();

    const observed = await observeProjectChanges(async () => {
        await sendChatMessage(input.prompt);
        await input.alongside?.();
        expect(
            runtimeMocks.generateWebLlmCompletion,
            `Case ${input.id} turn "${input.prompt}" declares ${String(input.providerTurns.length)} scripted provider turns but the run consumed a different number`
        ).toHaveBeenCalledTimes(input.providerTurns.length);
        return {
            barrelActions: input.barrel.actionsSince(mark),
            moved: captureSettledRevision() !== revision || pastEntries().length !== pastLength,
            newGroups: groupsAddedSince(entriesBefore),
            projectBefore,
            projectAfter: captureProjectTruth(),
        };
    });
    return { ...observed.result, transitions: observed.transitions, observations: observed.observations };
}

/** The prior card or commit, with frozen originals for Undo atop the current project. */
type PriorTurnState = {
    proposalId: string | undefined;
    commitGroupId: string | undefined;
    commitEntryIds: readonly string[];
    projectBeforeCommit: ProjectTruth;
    commitActions: readonly CorpusOracleAction[];
};

/**
 * Brings the prior turn to the state its case declares. A turn that must commit is confirmed where
 * the risk policy put it to the musician, so its commit takes the real confirmed-batch path and the
 * undo history holds its revert group either way.
 */
async function settlePriorTurn(
    id: string,
    outcome: CorpusPriorTurn['outcome'],
    projectBeforeCommit: ProjectTruth,
    commitActions: readonly CorpusOracleAction[]
): Promise<PriorTurnState> {
    const proposed = proposedConfirmationIds();
    if (outcome === 'pending') {
        expect(proposed, `Case ${id} prior turn left no single card pending: ${lastAssistantReply()}`).toHaveLength(1);
        return {
            proposalId: proposed[0],
            commitGroupId: undefined,
            commitEntryIds: [],
            projectBeforeCommit,
            commitActions,
        };
    }
    expect(proposed.length, `Case ${id} prior turn left more than one card pending`).toBeLessThanOrEqual(1);
    for (const confirmationId of proposed) {
        await expect(confirmPendingChatActions({ confirmationId })).resolves.toEqual({ status: 'executed' });
    }
    expect(
        readChatThreadContext()?.lastCommit?.standing,
        `Case ${id} prior turn committed nothing that stands: ${lastAssistantReply()}`
    ).toBe('standing');
    const commitGroupId = undoHistoryStore.value?.past.at(-1)?.groupId;
    if (commitGroupId === undefined) {
        throw new Error(`Case ${id} prior commit has no Undo group.`);
    }
    const entries = pastEntries().filter((entry) => entry.groupId === commitGroupId);
    expect(
        landedActionsMatch(id, committedGroupActions(entries), [...commitActions]),
        `Case ${id} prior Undo group does not match its frozen command oracle`
    ).toBe(true);
    const commitEntryIds = Object.freeze(entries.map((entry) => entry.id));
    expect(new Set(commitEntryIds).size, `Case ${id} prior Undo group repeats an entry identity`).toBe(
        commitEntryIds.length
    );
    return { proposalId: undefined, commitGroupId, commitEntryIds, projectBeforeCommit, commitActions };
}

/** The commands one undo group holds applied, or `null` when any member is no plain action. */
function committedGroupActions(entries: readonly PastEntry[]): LandedAction[] | null {
    const actions = entries.flatMap((entry) => (entry.kind === 'action' ? [entry.action] : []));
    return actions.length === entries.length ? actions : null;
}

/** The card that replaced the prior one: the only card proposed, superseding it, the prior one retired. */
function replacementCardActions(prior: PriorTurnState): LandedAction[] | null {
    const proposed = proposedConfirmationIds();
    const replacement = proposed.length === 1 ? getPendingActionConfirmation(proposed[0] ?? '') : null;
    if (replacement === null || prior.proposalId === undefined || replacement.supersedes !== prior.proposalId) {
        return null;
    }
    return getPendingActionConfirmation(prior.proposalId)?.status === 'proposed' ? null : replacement.actions;
}

/**
 * The follow-up's own batch on top of a commit: exactly one new undo group and no card, whose entries
 * are the only writes it may make, or one new card superseding nothing beside no new group, which
 * may write nothing. Two new groups, or a group beside a card, land no single batch.
 */
type FollowUpBatch = { actions: LandedAction[]; commitEntries: LandedAction[] | null };

function followUpBatch(writes: ChatTurnWrites): FollowUpBatch | null {
    const proposed = proposedConfirmationIds();
    const [group, ...otherGroups] = writes.newGroups;
    if (proposed.length === 0) {
        const entries = group === undefined || otherGroups.length > 0 ? null : committedGroupActions(group);
        return entries === null ? null : { actions: entries, commitEntries: entries };
    }
    const card = proposed.length === 1 ? getPendingActionConfirmation(proposed[0] ?? '') : null;
    if (card === null || card.supersedes !== null || writes.newGroups.length > 0) {
        return null;
    }
    return { actions: card.actions, commitEntries: null };
}

/**
 * Chat commits dispatch inside Command rather than through its public barrel. A side call cannot
 * borrow a committed entry's permission by carrying the same payload; project truth independently
 * verifies every permitted field and value, including writes that bypass both routes.
 */
function writesBeyondCommit(
    writes: ChatTurnWrites,
    commitEntries: readonly LandedAction[] | null,
    oracle: readonly CorpusOracleAction[]
): number {
    if (commitEntries === null) {
        return anyWrites(writes);
    }
    return Math.max(
        writes.barrelActions.length,
        projectDifferences(projectAfterOracleActions(writes.projectBefore, oracle), writes.projectAfter),
        observedDifferences(writes, commitPrefixes(writes.projectBefore, oracle))
    );
}

/** The undo of the prior commit: the planned revert names its group, and the history holds it undone whole. */
function revertsPriorCommit(outcome: PlanningOutcome, prior: PriorTurnState): boolean {
    const history = undoHistoryStore.value;
    const future = history?.future ?? [];
    const futureGroup = future.filter((entry) => entry.groupId === prior.commitGroupId);
    return (
        outcome.kind === 'revert' &&
        prior.commitGroupId !== undefined &&
        outcome.revertGroupId === prior.commitGroupId &&
        (history?.past ?? []).every((entry) => entry.groupId !== prior.commitGroupId) &&
        prior.commitEntryIds.length > 0 &&
        futureGroup.length === prior.commitEntryIds.length &&
        // Grouped Redo consumes the contiguous head in original commit order.
        prior.commitEntryIds.every(
            (id, index) =>
                future[index]?.id === id &&
                future[index]?.groupId === prior.commitGroupId &&
                future.filter((entry) => entry.id === id).length === 1
        )
    );
}

function landedActionsMatch(id: string, landed: LandedAction[] | null, expected: CorpusOracleAction[]): boolean {
    return (
        landed !== null &&
        landed.length === expected.length &&
        landed.every((action, index) => payloadMatches(action, expected[index], `${id} actions[${String(index)}]`))
    );
}

type FollowUpScore = { matchesOracle: boolean; unintendedMutations: number };

/**
 * Scores the follow-up against its oracle from what the chat route left in the stores, never the plan
 * alone, and counts every write the oracle does not name:
 * - a pending card's replacement must supersede it and write nothing at all;
 * - a follow-up on a commit must land exactly one batch, and every barrel write beyond its own
 *   committed entries is unintended;
 * - an undo must leave the commit's group undone and redoable, which any later undoable write would
 *   discard, and since the undo replays through Command's group revert rather than the barrel, every
 *   barrel write beside it is unintended.
 * A follow-up that misses its oracle wrote nothing the oracle names, so all its writes count.
 */
function scoreFollowUp(input: {
    testCase: CorpusCase;
    outcome: PlanningOutcome;
    prior: PriorTurnState;
    writes: ChatTurnWrites;
}): FollowUpScore {
    const { testCase, outcome, prior, writes } = input;
    const missed = { matchesOracle: false, unintendedMutations: anyWrites(writes) };
    switch (testCase.oracle.kind) {
        case 'revert':
            if (!revertsPriorCommit(outcome, prior)) {
                return missed;
            }
            return {
                matchesOracle: true,
                unintendedMutations: Math.max(
                    writes.barrelActions.length,
                    projectDifferences(
                        projectAfterOracleUndo(prior.projectBeforeCommit, writes.projectBefore, prior.commitActions),
                        writes.projectAfter
                    ),
                    observedDifferences(
                        writes,
                        undoPrefixes(prior.projectBeforeCommit, writes.projectBefore, prior.commitActions)
                    )
                ),
            };
        case 'proposal': {
            if (testCase.oracle.replaces === 'prior-proposal') {
                const unintendedMutations = anyWrites(writes);
                const replaced = landedActionsMatch(
                    testCase.id,
                    replacementCardActions(prior),
                    testCase.oracle.actions
                );
                return { matchesOracle: unintendedMutations === 0 && replaced, unintendedMutations };
            }
            const batch = followUpBatch(writes);
            if (batch === null || !landedActionsMatch(testCase.id, batch.actions, testCase.oracle.actions)) {
                return missed;
            }
            return {
                matchesOracle: true,
                unintendedMutations: writesBeyondCommit(writes, batch.commitEntries, testCase.oracle.actions),
            };
        }
        default:
            throw new Error(
                `Refinement case ${testCase.id} declares an oracle no follow-up lands: ${testCase.oracle.kind}`
            );
    }
}

/**
 * Runs one refinement case through the chat route a musician's follow-up takes: the prior turn, then
 * the follow-up, each planned with the thread the chat reads, so thread context, `refines`
 * admission, the grounding basis and the last-commit continuation all run for real. Writes the prior
 * turn makes to reach a commit are the case's setup; any other write its oracle did not ask for is
 * unintended. `alongside` lets a self-check write beside the follow-up.
 */
async function runRefinementCase(
    testCase: CorpusCase,
    barrel: BarrelWriteLog,
    alongside?: () => Promise<void>,
    alongsidePrior?: () => Promise<void>,
    beforeFollowUp?: () => Promise<void>
): Promise<CaseRun> {
    const { prior, refinementKind } = testCase;
    if (prior === undefined || refinementKind === undefined) {
        throw new Error(`Refinement case ${testCase.id} names no prior turn or refinement kind`);
    }
    assertOracleKindFitsClass(testCase);
    openChatProject();
    try {
        const projectBeforePrior = captureProjectTruth();
        const priorActions = prior.outcome === 'committed' ? priorCommitOracleActions(prior) : [];
        const observedPrior = await observeProjectChanges(async () => {
            const priorWrites = await sendScriptedChatTurn({
                id: testCase.id,
                prompt: prior.prompt,
                providerTurns: prior.providerTurns,
                priorProposalId: () => undefined,
                barrel,
                alongside: alongsidePrior,
            });
            const priorState = await settlePriorTurn(testCase.id, prior.outcome, projectBeforePrior, priorActions);
            return { priorWrites, priorState };
        });
        const { priorWrites, priorState } = observedPrior.result;
        let priorUnintendedMutations = anyWrites(priorWrites);
        if (prior.outcome === 'committed') {
            priorUnintendedMutations = Math.max(
                priorWrites.barrelActions.length,
                projectDifferences(projectAfterOracleActions(projectBeforePrior, priorActions), captureProjectTruth()),
                observedDifferences(observedPrior, commitPrefixes(projectBeforePrior, priorActions))
            );
        }
        for (const edit of testCase.interveningFaderEdits ?? []) {
            const expectedGain = trackStore.value?.tracks.find((track) => track.id === edit.trackId)?.gain;
            if (expectedGain === undefined) {
                throw new Error(`The intervening edit names no fixture track ${edit.trackId}.`);
            }
            await commandUseCases.executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: edit.trackId, gainDb: edit.gainDb, expectedGain },
            });
        }
        await beforeFollowUp?.();
        const writes = await sendScriptedChatTurn({
            id: testCase.id,
            prompt: testCase.prompt,
            providerTurns: testCase.providerTurns,
            priorProposalId: () => priorState.proposalId,
            barrel,
            alongside,
        });
        const outcome = chatPlanning.last?.planningOutcome;
        if (outcome === undefined) {
            throw new Error(`Case ${testCase.id} follow-up was never planned: ${lastAssistantReply()}`);
        }
        const observed = classifyPlanningOutcome(outcome, chatPlanning.last?.actions.length ?? 0);
        if (observed === null) {
            throw new Error(`Case ${testCase.id} observed no scorable outcome class (kind=${outcome.kind})`);
        }
        const followUp = scoreFollowUp({ testCase, outcome, prior: priorState, writes });
        return {
            result: scoreAgentAcceptanceCase({
                id: testCase.id,
                expectedClass: testCase.class,
                promptClass: testCase.promptClass,
                oracleKind: testCase.oracle.kind,
                observed,
                matchesOracle: followUp.matchesOracle,
            }),
            unintendedMutations: priorUnintendedMutations + followUp.unintendedMutations,
        };
    } finally {
        closeChatProject();
    }
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
        'per-prompt-class execute recall (each sealed class of eleven)'
    );
    const promptClassExecutePrecisionMin = readThresholdRow(
        doc,
        'per-prompt-class execute precision (each sealed class of eleven)'
    );
    const answerPrecisionMin = readThresholdRow(doc, 'answer-exact precision (all observed answers)');
    const answerRecallMin = readThresholdRow(doc, 'question answer-exact recall');
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
            answerPrecisionMin: answerPrecisionMin.development,
            answerRecallMin: answerRecallMin.development,
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
            answerPrecisionMin: answerPrecisionMin.heldOut,
            answerRecallMin: answerRecallMin.heldOut,
            clarifyRequiredPrecision: clarifyRequiredPrecision.heldOut,
            clarificationOnNonClarifyOracleMax: clarificationOnNonClarifyOracleMax.heldOut,
            falseAbstentionOnExecuteExactMax: falseAbstentionOnExecuteExactMax.heldOut,
        },
    };
}

function assertRefinementCaseFloors(corpus: Corpus): void {
    const refinementCases = corpus.cases.filter((entry) => entry.promptClass === 'refinement');
    for (const kind of REFINEMENT_KINDS) {
        expect(
            refinementCases.filter((entry) => entry.refinementKind === kind).length,
            `The refinement class carries too few ${kind} cases`
        ).toBeGreaterThanOrEqual(MINIMUM_SEALED_CLASS_CASES);
    }
}

function assertRefinementCaseSchemas(corpus: Corpus): void {
    const refinementCases = corpus.cases.filter((entry) => entry.promptClass === 'refinement');
    for (const testCase of refinementCases) {
        const kind = testCase.refinementKind;
        expect(REFINEMENT_KINDS, `Case ${testCase.id} declares an unknown refinement kind`).toContain(kind);
        if (kind === undefined) {
            continue;
        }
        expect(testCase.prior?.outcome, `Case ${testCase.id} follows the wrong prior turn`).toBe(
            PRIOR_OUTCOME_BY_KIND[kind]
        );
        expect(testCase.class, `Case ${testCase.id} is no executed change`).toBe('execute-exact');
        expect(
            refinementOracleShape(testCase.oracle),
            `Case ${testCase.id} declares the wrong oracle for ${kind}`
        ).toBe(REFINEMENT_ORACLE_SHAPE[kind]);
    }
    for (const testCase of corpus.cases.filter((entry) => entry.promptClass !== 'refinement')) {
        expect(testCase.prior, `Case ${testCase.id} follows a turn outside the refinement class`).toBe(undefined);
    }
}

function assertHeldOutDisjointness(development: Corpus, heldOut: Corpus): void {
    const developmentPrompts = new Set(development.cases.flatMap(casePrompts));
    for (const heldOutPrompt of heldOut.cases.flatMap(casePrompts)) {
        expect(developmentPrompts.has(heldOutPrompt), `Held-out prompt "${heldOutPrompt}" is in development`).toBe(
            false
        );
    }
}

const fixtureLifetime = createAcceptanceFixtureLifetime();
function deferredFixtureEvent() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}
const parentBoundary = {
    body: deferredFixtureEvent(),
    deadline: deferredFixtureEvent(),
    integrationAdmission: deferredFixtureEvent(),
    events: [] as string[],
    reason: '',
    owner: undefined as Promise<void> | undefined,
    controller: undefined as Promise<void> | undefined,
};

describe('scripted proposal plans', () => {
    it('preserves the original default and forwards an explicit plan unchanged', () => {
        const items = [{ id: 'item', name: 'setTrackGain', arguments: { gainDb: -3 } }];
        expect(proposeCall(items)).toEqual({
            name: 'command.batch.propose',
            arguments: {
                plan: {
                    semantic: { classification: 'complex', uncertainty: [] },
                    objective: 'Lay out a blues chord progression on a MIDI track this batch creates.',
                    constraints: ['Leave every object the project already holds unchanged.'],
                    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
                    capabilityIds: [],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate that the notes land inside the clip the batch creates.'],
                    stoppingConditions: ['Stop if the created clip cannot hold the progression.'],
                },
                list: { schemaVersion: 1, items },
            },
        });
        const turn = corpusCase('development', 'AC054-DEV-BULK-1').providerTurns[3];
        if (turn?.kind !== 'propose' || turn.plan === undefined) {
            throw new Error('Missing explicit bulk plan');
        }
        expect(proposeCall(items, turn.plan).arguments.plan).toBe(turn.plan);
    });
});

describe('agent acceptance corpora', () => {
    beforeEach(() => fixtureLifetime.drain());
    it('carries unique case ids across both corpora and held-out prompts disjoint from development', () => {
        const allIds = [...corpora.development.cases, ...corpora['held-out'].cases].map((testCase) => testCase.id);
        expect(new Set(allIds).size).toBe(allIds.length);

        assertHeldOutDisjointness(corpora.development, corpora['held-out']);
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
                    if (promptClass === 'question') {
                        expect(testCase.class).toBe('answer-exact');
                        expect(testCase.oracle.kind).toBe('answer');
                        parseAnswerOracle(testCase.oracle);
                    } else {
                        expect(testCase.class).not.toBe('answer-exact');
                        expect(testCase.oracle.kind).not.toBe('answer');
                    }
                    expect(
                        testCase.oracle.kind,
                        `Case ${testCase.id} is pending inside sealed ${promptClass}`
                    ).not.toBe('pending');
                }
            }
        });

        it('declares one positive intake before every scripted mutation or answer within the existing turn ceiling', () => {
            for (const testCase of corpus.cases) {
                for (const frame of [testCase, testCase.prior]) {
                    if (frame === undefined) {
                        continue;
                    }
                    const interpreted = frame.providerTurns.some(
                        (turn) => turn.kind === 'propose' || turn.kind === 'propose-commands' || turn.kind === 'answer'
                    );
                    const intakes = frame.providerTurns.filter((turn) => turn.kind === 'intake');
                    if (interpreted) {
                        expect(frame.providerTurns[0]?.kind, `${testCase.id}: ${frame.prompt}`).toBe('intake');
                        expect(frame.providerTurns[0]).toEqual(intakes[0]);
                        expect(intakes).toHaveLength(1);
                        expect(frame.providerTurns.length).toBeLessThanOrEqual(5);
                    } else {
                        expect(intakes).toEqual([]);
                    }
                }
            }
        });

        it('gives every refinement kind its own cases, each following the turn its kind needs', () => {
            assertRefinementCaseFloors(corpus);
            assertRefinementCaseSchemas(corpus);
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
        const cases = scoredCases(corpora[corpusName]);
        const completed = new Map<string, CaseRun>();
        for (const testCase of cases) {
            it(
                `scores ${testCase.id}`,
                async (context) => {
                    let run: CaseRun | undefined;
                    context.onTestFinished(() => {
                        if (context.task.result?.state === 'pass' && !context.signal.aborted && run !== undefined) {
                            if (completed.has(testCase.id)) {
                                throw new Error(`Duplicate case ${testCase.id}`);
                            }
                            completed.set(testCase.id, run);
                        }
                    });
                    await fixtureLifetime.track(async () => {
                        const barrel = spyOnBarrelWrites();
                        try {
                            run = await runCorpusCase(testCase, barrel.log);
                        } finally {
                            barrel.restore();
                        }
                    });
                },
                CORPUS_RUN_TIMEOUT_MS
            );
        }
        afterAll(() => {
            const runs = completeAcceptanceResults(
                cases.map((testCase) => testCase.id),
                completed
            );
            const results = runs.map((run) => run.result);
            expect(results).toHaveLength(cases.length);
            for (const result of results) {
                expect(result.observed).toBeDefined();
            }
            const unintendedMutations = runs.reduce((total, run) => total + run.unintendedMutations, 0);
            const metrics = computeAgentAcceptanceMetrics(results, unintendedMutations);
            expect(metrics.unintendedMutations).toBe(0);
            expect(
                failedAgentAcceptanceThresholds(metrics, corpusName, sealedScoredClasses(corpora[corpusName]))
            ).toEqual([]);
        });
    });

    describe('corpus validation self-checks', () => {
        it.each(REFINEMENT_KINDS)('rejects fewer than the required %s cases', (kind) => {
            let retained = 0;
            const cases = corpora.development.cases.filter((testCase) => {
                if (testCase.refinementKind !== kind) {
                    return true;
                }
                retained += 1;
                return retained < MINIMUM_SEALED_CLASS_CASES;
            });
            expect(() => assertRefinementCaseFloors({ ...corpora.development, cases })).toThrow(
                `too few ${kind} cases`
            );
        });

        it.each(['prior', 'class', 'oracle', 'kind', 'outside-refinement'] as const)(
            'rejects a malformed later case: %s',
            (violation) => {
                const valid = corpusCase('development', 'AC004-DEV-SCALE-1');
                const invalid: CorpusCase = { ...valid, id: 'invalid-later-case' };
                switch (violation) {
                    case 'prior':
                        invalid.prior = undefined;
                        break;
                    case 'class':
                        invalid.class = 'deny-policy';
                        break;
                    case 'oracle':
                        invalid.oracle = { kind: 'revert', group: 'prior-commit' };
                        break;
                    case 'kind':
                        invalid.refinementKind = undefined;
                        break;
                    case 'outside-refinement':
                        invalid.promptClass = 'literal-structural';
                        break;
                }
                expect(() => assertRefinementCaseSchemas({ ...corpora.development, cases: [valid, invalid] })).toThrow(
                    'invalid-later-case'
                );
            }
        );

        it.each(['follow-up', 'prior'] as const)(
            'rejects held-out reuse of a development prior prompt in its %s',
            (position) => {
                const developmentCase = corpusCase('development', 'AC004-DEV-SCALE-1');
                const heldOutCase = corpusCase('held-out', 'AC004-HO-SCALE-1');
                const prior = developmentCase.prior;
                const heldOutPrior = heldOutCase.prior;
                if (prior === undefined || heldOutPrior === undefined) {
                    throw new Error('Both disjointness fixtures need prior turns.');
                }
                let invalid: CorpusCase;
                if (position === 'follow-up') {
                    invalid = { ...heldOutCase, prompt: prior.prompt };
                } else {
                    invalid = { ...heldOutCase, prior: { ...heldOutPrior, prompt: prior.prompt } };
                }
                expect(() =>
                    assertHeldOutDisjointness(corpora.development, {
                        ...corpora['held-out'],
                        cases: [invalid],
                    })
                ).toThrow('is in development');
            }
        );
    });

    describe('write-counter self-checks', () => {
        let previousHistory: NonNullable<typeof undoHistoryStore.value>;
        let previousConfirmations: NonNullable<typeof pendingActionConfirmationStore.value>;
        let setupCompleted = false;

        beforeEach(() => {
            const history = undoHistoryStore.value;
            const confirmations = pendingActionConfirmationStore.value;
            if (history === null || confirmations === null) {
                throw new Error('The accounting stores must be available.');
            }
            previousHistory = history;
            previousConfirmations = confirmations;
            setupCompleted = true;
            undoHistoryStore.set({ past: [], future: [] });
            clearPendingActionConfirmations();
        });
        afterEach(() => {
            if (!setupCompleted) {
                return Promise.resolve();
            }
            setupCompleted = false;
            return fixtureLifetime.cleanup(() => {
                undoHistoryStore.set(previousHistory);
                pendingActionConfirmationStore.set(previousConfirmations);
            });
        });

        function truthFixture() {
            return {
                root: {
                    tracks: {
                        tracks: [
                            {
                                id: 'track-lead-vocal',
                                gain: 1,
                                muted: false,
                                pan: 0,
                                groupId: 'group-a',
                                clips: [{ id: 'clip-a', startBeat: 0 }],
                                devices: [{ id: 'device-a', parameterValues: { cutoff: 100 } }],
                            },
                        ],
                    },
                    groups: [{ id: 'group-a', name: 'Vocals' }],
                },
            };
        }
        function writesFixture(overrides: Partial<ChatTurnWrites> = {}): ChatTurnWrites {
            const projectBefore = truthFixture();
            return {
                barrelActions: [],
                moved: false,
                newGroups: [],
                projectBefore,
                projectAfter: structuredClone(projectBefore),
                transitions: [],
                observations: [],
                ...overrides,
            };
        }
        const action: AppAction = {
            type: 'setTrackGain',
            payload: { trackId: 'track-lead-vocal', gain: 1, expectedGain: 1 },
        };
        const oracle: CorpusOracleAction[] = [
            { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 1 } },
        ];
        function entry(id: string, groupId?: string): PastEntry {
            const value: PastEntry = {
                kind: 'action',
                id,
                label: id,
                timestamp: 0,
                source: 'ai',
                action,
                inverseAction: null,
            };
            if (groupId !== undefined) {
                value.groupId = groupId;
            }
            return value;
        }

        it('counts a revision or history move even without a barrel call or surviving field change', () => {
            expect(anyWrites(writesFixture({ moved: true }))).toBe(1);
            expect(anyWrites(writesFixture())).toBe(0);
        });

        it('does not let an identical committed entry answer for an extra barrel write', () => {
            expect(writesBeyondCommit(writesFixture({ barrelActions: [action] }), [action], oracle)).toBe(1);
            expect(writesBeyondCommit(writesFixture({ barrelActions: [action, action] }), [action], oracle)).toBe(2);
        });

        it('counts no writes for a clean uncommitted card but counts every write beside it', () => {
            expect(writesBeyondCommit(writesFixture(), null, oracle)).toBe(0);
            expect(writesBeyondCommit(writesFixture({ moved: true }), null, oracle)).toBe(1);
        });

        it('groups new entries by their group id while keeping ungrouped entries separate', () => {
            const old = entry('old', 'old-group');
            const first = entry('first', 'new-group');
            const second = entry('second', 'new-group');
            const ungroupedFirst = entry('ungrouped-first');
            const ungroupedSecond = entry('ungrouped-second');
            undoHistoryStore.set({ past: [old, first, second, ungroupedFirst, ungroupedSecond], future: [] });
            expect(groupsAddedSince(new Set([old]))).toEqual([[first, second], [ungroupedFirst], [ungroupedSecond]]);
            expect(followUpBatch(writesFixture({ newGroups: [[first, second]] }))?.actions).toEqual([action, action]);
            expect(followUpBatch(writesFixture({ newGroups: [[first], [second]] }))).toBeNull();
        });

        it('refuses a pending card with a new history group beside it', () => {
            const card = proposePendingActionConfirmation({
                id: 'counter-card',
                prompt: 'Set vocal gain',
                assistantMessageId: 'counter-message',
                actions: [action],
                actionLabels: ['Set vocal gain'],
                projectRevision: 'counter-revision',
            });
            expect(card).not.toBeNull();
            expect(followUpBatch(writesFixture())?.commitEntries).toBeNull();
            expect(followUpBatch(writesFixture({ newGroups: [[entry('extra', 'extra-group')]] }))).toBeNull();
        });

        it('refuses a follow-up card claiming to supersede an unrelated proposal', () => {
            const card = proposePendingActionConfirmation({
                id: 'wrong-supersedes-card',
                prompt: 'Set vocal gain',
                assistantMessageId: 'wrong-supersedes-message',
                actions: [action],
                actionLabels: ['Set vocal gain'],
                projectRevision: 'counter-revision',
                supersedes: 'unrelated-proposal',
            });
            expect(card).not.toBeNull();
            expect(followUpBatch(writesFixture())).toBeNull();
        });

        it('permits only the named mute field and preserves the input project snapshot', () => {
            const before = truthFixture();
            const expected = structuredClone(before);
            const after = projectAfterOracleActions(before, [
                { type: 'muteTrack', payload: { trackId: 'track-lead-vocal', muted: true } },
            ]);
            expect(before).toEqual(expected);
            expect(projectDifferences(before, after)).toBe(1);
            expect(after.root?.tracks).toEqual({
                tracks: [{ ...before.root.tracks.tracks[0], muted: true }],
            });
        });

        type TruthFixture = ReturnType<typeof truthFixture>;
        it.each([
            {
                field: 'clip placement',
                change: (truth: TruthFixture) => {
                    truth.root.tracks.tracks[0]!.clips[0]!.startBeat = 2;
                },
            },
            {
                field: 'device parameter',
                change: (truth: TruthFixture) => {
                    truth.root.tracks.tracks[0]!.devices[0]!.parameterValues.cutoff = 200;
                },
            },
            {
                field: 'track group',
                change: (truth: TruthFixture) => {
                    truth.root.tracks.tracks[0]!.groupId = 'group-b';
                },
            },
            {
                field: 'group field',
                change: (truth: TruthFixture) => {
                    truth.root.groups[0]!.name = 'Changed';
                },
            },
            {
                field: 'clip removal',
                change: (truth: TruthFixture) => {
                    truth.root.tracks.tracks[0]!.clips = [];
                },
            },
        ])('detects an unapproved $field independently of action logs', ({ change }) => {
            const before = truthFixture();
            const after = structuredClone(before);
            change(after);
            expect(projectDifferences(before, after)).toBe(1);
        });

        it('detects project document creation and removal', () => {
            const before = truthFixture();
            const after = { ...before, 'unexpected-document': { gain: 1 } };
            expect(projectDifferences(before, after)).toBe(1);
            expect(projectDifferences(after, before)).toBe(1);
        });

        it.each([
            { before: new Date(0), after: new Date(1) },
            { before: new Uint8Array([1]), after: { 0: 1 } },
        ])('counts unequal typed project values rather than only their enumerable fields: %j', ({ before, after }) => {
            expect(projectDifferences(before, after)).toBe(1);
        });

        it('surfaces capture failures, preserves run failures and unsubscribes', () =>
            fixtureLifetime.track(async () => {
                openChatProject();
                let captures = 0;
                const captureFailure = new Error('capture failure');
                const capture = () => {
                    captures++;
                    throw captureFailure;
                };
                let writes = 0;
                const write = () =>
                    mutateCrdtDoc<Record<string, unknown>>({
                        id: 'root',
                        changeFn: (document) => {
                            document.observerProbe = ++writes;
                        },
                    });
                try {
                    await expect(
                        observeProjectChanges(async () => {
                            write();
                        }, capture)
                    ).rejects.toBe(captureFailure);
                    const afterCapture = captures;
                    write();
                    expect(captures).toBe(afterCapture);
                    const runFailure = new Error('run failure');
                    await expect(
                        observeProjectChanges(async () => {
                            write();
                            throw runFailure;
                        }, capture)
                    ).rejects.toBe(runFailure);
                    const afterRun = captures;
                    expect(afterRun).toBeGreaterThan(afterCapture);
                    write();
                    expect(captures).toBe(afterRun);
                } finally {
                    closeChatProject();
                }
            }));

        it('surfaces root capture failures, preserves run failures and unsubscribes', async () => {
            openChatProject();
            const original = getCrdtDoc('root');
            if (original === undefined) {
                throw new Error('Missing active root');
            }
            let captures = 0;
            const captureFailure = new Error('root capture failure');
            const captureRoot = () => {
                captures++;
                throw captureFailure;
            };
            try {
                await expect(
                    observeProjectChanges(
                        async () => {
                            createCrdtDoc('root', clone(original));
                        },
                        materializeProjectTruth,
                        captureRoot
                    )
                ).rejects.toBe(captureFailure);
                const afterCapture = captures;
                createCrdtDoc('root', original);
                expect(captures).toBe(afterCapture);
                const runFailure = new Error('run failure');
                await expect(
                    observeProjectChanges(
                        async () => {
                            createCrdtDoc('root', clone(original));
                            throw runFailure;
                        },
                        materializeProjectTruth,
                        captureRoot
                    )
                ).rejects.toBe(runFailure);
                const afterRun = captures;
                expect(afterRun).toBeGreaterThan(afterCapture);
                createCrdtDoc('root', original);
                expect(captures).toBe(afterRun);
            } finally {
                closeChatProject();
            }
        });

        it('fails closed on a terminal root event and leaves no observer in the next project session', async () => {
            openChatProject();
            const original = getCrdtDoc('root');
            if (original === undefined) {
                throw new Error('Missing active root');
            }
            let captures = 0;
            const capture = () => {
                captures++;
                return materializeProjectTruth();
            };
            const subscribeRoot = crdtDocumentUseCases.subscribeToActiveRootInstallations;
            const subscribeChanges = crdtDocumentUseCases.subscribeToCrdtChanges;
            const rootUnsubscribe = vi.fn();
            const changesUnsubscribe = vi.fn();
            let rootListener: Parameters<typeof subscribeRoot>[0] | undefined;
            const rootSubscription = vi
                .spyOn(crdtDocumentUseCases, 'subscribeToActiveRootInstallations')
                .mockImplementation((listener) => {
                    rootListener = listener;
                    const unsubscribe = subscribeRoot(listener);
                    return () => {
                        rootUnsubscribe();
                        unsubscribe();
                    };
                });
            const changesSubscription = vi
                .spyOn(crdtDocumentUseCases, 'subscribeToCrdtChanges')
                .mockImplementation((listener) => {
                    const unsubscribe = subscribeChanges(listener);
                    return () => {
                        changesUnsubscribe();
                        unsubscribe();
                    };
                });
            try {
                await expect(
                    observeProjectChanges(
                        async () => {
                            if (rootListener === undefined) {
                                throw new Error('Missing active root installation listener');
                            }
                            createCrdtDoc('root', clone(original));
                            expect(captures).toBe(1);
                            rootListener({ kind: 'reset' });
                        },
                        capture,
                        (document) => {
                            captures++;
                            return materializeInstalledRoot(document);
                        }
                    )
                ).rejects.toThrow('Acceptance project reset during observation.');
                const afterReset = captures;
                expect(rootSubscription).toHaveBeenCalledTimes(1);
                expect(changesSubscription).toHaveBeenCalledTimes(1);
                expect(rootUnsubscribe).toHaveBeenCalledTimes(1);
                expect(changesUnsubscribe).toHaveBeenCalledTimes(1);
                resetCrdtProjectAuthority('next session');
                createCrdtDoc('root');
                mutateCrdtDoc({
                    id: 'root',
                    changeFn: (document: Record<string, unknown>) => {
                        document.nextSession = true;
                    },
                });
                expect(captures).toBe(afterReset);
            } finally {
                rootSubscription.mockRestore();
                changesSubscription.mockRestore();
                closeChatProject();
            }
        });

        it('accepts each authorized commit and undo prefix without admitting another field', () => {
            const before = truthFixture();
            const actions: CorpusOracleAction[] = [
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.8 } },
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.6 } },
            ];
            const commits = commitPrefixes(before, actions);
            const committed = commits.at(-1);
            if (committed === undefined) {
                throw new Error('Missing commit');
            }
            const undos = undoPrefixes(before, committed, actions);
            expect(transitionDifferences(commits, commits)).toBe(0);
            expect(transitionDifferences(undos, undos)).toBe(0);
            expect(projectDifferences(undos.at(-1), before)).toBe(0);
            const altered = truthFixture();
            altered.root.tracks.tracks[0]!.pan = 0.27;
            expect(transitionDifferences([altered], commits)).toBeGreaterThan(0);
        });

        it('undoes gain and mute in reverse prefixes while preserving a later independent fader edit', () => {
            const before = truthFixture();
            const original = before.root.tracks.tracks[0];
            if (original === undefined) {
                throw new Error('Missing original track');
            }
            before.root.tracks.tracks.push({ ...original, id: 'track-kick', gain: 0.7 });
            const actions: CorpusOracleAction[] = [
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.8 } },
                { type: 'muteTrack', payload: { trackId: 'track-lead-vocal', muted: true } },
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.6 } },
            ];
            const committed = projectAfterOracleActions(before, actions);
            const beforeUndo = projectAfterOracleActions(committed, [
                { type: 'setTrackGain', payload: { trackId: 'track-kick', gain: 0.3 } },
            ]);
            const afterGainUndo = projectAfterOracleActions(beforeUndo, [
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 0.8 } },
            ]);
            const afterMuteUndo = projectAfterOracleActions(afterGainUndo, [
                { type: 'muteTrack', payload: { trackId: 'track-lead-vocal', muted: false } },
            ]);
            const expected = projectAfterOracleActions(before, [
                { type: 'setTrackGain', payload: { trackId: 'track-kick', gain: 0.3 } },
            ]);
            const undos = undoPrefixes(before, beforeUndo, actions);
            expect(undos).toEqual([beforeUndo, afterGainUndo, afterMuteUndo, expected]);
            expect(projectAfterOracleUndo(before, beforeUndo, actions)).toEqual(expected);
            expect(transitionDifferences(undos, undos)).toBe(0);
            expect(transitionDifferences([afterMuteUndo, afterGainUndo], undos)).toBeGreaterThan(0);
            expect(projectDifferences(expected, afterGainUndo)).toBeGreaterThan(0);
            const wrongField = projectAfterOracleActions(afterGainUndo, [
                { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', gain: 1 } },
            ]);
            expect(transitionDifferences([wrongField], undos)).toBeGreaterThan(0);
        });

        it.each([
            { type: 'muteTrack', original: { gain: 1 }, payload: { muted: true } },
            { type: 'muteTrack', original: { gain: 1, muted: 1 }, payload: { muted: true } },
            { type: 'setTrackGain', original: { muted: false }, payload: { gain: 0.8 } },
            { type: 'setTrackGain', original: { gain: NaN, muted: false }, payload: { gain: 0.8 } },
            { type: 'setTrackGain', original: { gain: Infinity, muted: false }, payload: { gain: 0.8 } },
        ])('refuses Undo with missing or invalid original field: %j', ({ type, original, payload }) => {
            const before: ProjectTruth = {
                root: { tracks: { tracks: [{ id: 'track-lead-vocal', ...original }] } },
            };
            expect(() =>
                projectAfterOracleUndo(before, truthFixture(), [
                    { type, payload: { trackId: 'track-lead-vocal', ...payload } },
                ])
            ).toThrow(TypeError);
        });

        it('preserves typed project values in the captured safety snapshot', () => {
            openChatProject();
            try {
                mutateCrdtDoc<Record<string, unknown>>({
                    id: 'root',
                    changeFn: (document) => {
                        document.oracleTimestamp = new Date(0);
                        document.oracleBytes = new Uint8Array([1]);
                        document.oracleCounter = new Counter(1);
                    },
                });
                const truth = captureProjectTruth();
                expect(truth.root?.oracleTimestamp).toEqual(new Date(0));
                expect(truth.root?.oracleBytes).toEqual(new Uint8Array([1]));
                expect(truth.root?.oracleCounter).toEqual(new Counter(1));
                expect(projectDifferences(projectAfterOracleActions(truth, []), truth)).toBe(0);
                mutateCrdtDoc<Record<string, unknown>>({
                    id: 'root',
                    changeFn: (document) => {
                        document.oracleTimestamp = new Date(1);
                        document.oracleBytes = new Uint8Array([2]);
                    },
                });
                expect(projectDifferences(truth, captureProjectTruth())).toBe(2);
                expect(truth.root?.oracleTimestamp).toEqual(new Date(0));
            } finally {
                closeChatProject();
            }
        });

        it.each([
            { type: 'renameTrack', payload: { trackId: 'track-lead-vocal', name: 'Renamed' } },
            { type: 'muteTrack', payload: { trackId: 'track-lead-vocal', muted: 1 } },
            { type: 'setTrackGain', payload: { trackId: 'missing-track', gain: 1 } },
            { type: 'setTrackGain', payload: { gain: 1 } },
            { type: 'setTrackGain', payload: { trackId: 'track-lead-vocal', deltaDb: NaN } },
        ])('refuses a project oracle whose authorized field transition is unproven: %j', (action) => {
            expect(() => projectAfterOracleActions(truthFixture(), [action])).toThrow(TypeError);
        });
    });

    describe('refinement write accounting', () => {
        const relativeCase = corpusCase('development', 'AC004-DEV-RELATIVE-1');
        const undoCase = corpusCase('development', 'AC004-DEV-UNDO-1');
        const pendingCase = corpusCase('development', 'AC004-DEV-SCALE-1');

        /** A gain move the fader can take now, so Command lands it rather than refusing a stale one. */
        function gainMove(trackId: string, deltaDb: number): AppAction {
            const expectedGain = trackStore.value?.tracks.find((track) => track.id === trackId)?.gain;
            if (expectedGain === undefined) {
                throw new Error(`The fixture project holds no track ${trackId}`);
            }
            return { type: 'setTrackGain', payload: { trackId, deltaDb, expectedGain } };
        }

        async function runWithBarrel(
            testCase: CorpusCase,
            alongside?: () => Promise<void>,
            alongsidePrior?: () => Promise<void>,
            beforeFollowUp?: () => Promise<void>
        ): Promise<CaseRun & { observedBarrelWrites: number }> {
            return fixtureLifetime.track(async () => {
                const barrel = spyOnBarrelWrites();
                try {
                    const result = await runRefinementCase(
                        testCase,
                        barrel.log,
                        alongside,
                        alongsidePrior,
                        beforeFollowUp
                    );
                    return { ...result, observedBarrelWrites: barrel.log.count() };
                } finally {
                    barrel.restore();
                }
            });
        }

        describe.each(AGENT_ACCEPTANCE_CORPORA)('%s expanded refinement cases', (corpusName) => {
            it.each([
                'UNDO-MULTI-TRACK',
                'UNDO-MULTI-COMMAND',
                'RETARGET-MULTI-TRACK',
                'RETARGET-MULTI-COMMAND',
                'RELATIVE-ABSOLUTE',
            ])('%s meets its own oracle without any unintended writes', async (suffix) => {
                let prefix = 'DEV';
                if (corpusName === 'held-out') {
                    prefix = 'HO';
                }
                const testCase = corpusCase(corpusName, `AC004-${prefix}-${suffix}`);
                const run = await runWithBarrel(testCase, async () => {
                    if (testCase.oracle.kind !== 'revert') {
                        return;
                    }
                    for (const edit of testCase.interveningFaderEdits ?? []) {
                        const track = trackStore.value?.tracks.find((candidate) => candidate.id === edit.trackId);
                        expect(track?.gain, 'Undo must preserve the later musician edit').toBeCloseTo(
                            10 ** (edit.gainDb / 20),
                            10
                        );
                    }
                });
                expect(run.result, JSON.stringify(chatPlanning.last?.planningOutcome)).toMatchObject({
                    observed: 'execute-exact',
                    exactMatch: true,
                });
                expect(run.unintendedMutations).toBe(0);
            });
        });

        async function persistKickPanAndRestore(): Promise<void> {
            const state = trackStore.value;
            if (state === null) {
                throw new Error('Missing project');
            }
            const kick = state.tracks.find((track) => track.id === 'track-kick');
            if (kick === undefined) {
                throw new Error('Missing kick');
            }
            const before = captureSettledRevision();
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => (track.id === kick.id ? { ...track, pan: 0.27 } : track)),
            });
            const changed = captureSettledRevision();
            const updated = trackStore.value;
            if (updated === null) {
                throw new Error('Missing project');
            }
            trackStore.set({
                ...updated,
                tracks: updated.tracks.map((track) => (track.id === kick.id ? { ...track, pan: kick.pan } : track)),
            });
            const restored = captureSettledRevision();
            expect(changed).not.toBe(before);
            expect(restored).not.toBe(changed);
        }

        async function installKickPanAndRestore(): Promise<void> {
            const original = getCrdtDoc<{ tracks: { tracks: { id: string; pan: number }[] } }>('root');
            if (original === undefined) {
                throw new Error('Missing active root');
            }
            const altered = change(clone(original), (document) => {
                const kick = document.tracks.tracks.find((track) => track.id === 'track-kick');
                if (kick === undefined) {
                    throw new Error('Missing kick in active root');
                }
                kick.pan = 0.27;
            });
            createCrdtDoc('root', altered);
            expect(
                getCrdtDoc<{ tracks: { tracks: { id: string; pan: number }[] } }>('root')?.tracks.tracks.find(
                    (track) => track.id === 'track-kick'
                )?.pan
            ).toBe(0.27);
            createCrdtDoc('root', original);
        }

        it('counts a restored root installation while scoring a role-selected bulk plan', async () => {
            openChatProject();
            const barrel = spyOnBarrelWrites();
            try {
                const testCase = corpusCase('development', 'AC054-DEV-BULK-1');
                const run = await runCorpusCase(testCase, barrel.log, installKickPanAndRestore);
                expect(run.result.exactMatch).toBe(true);
                expect(barrel.log.count()).toBe(0);
                expect(run.unintendedMutations).toBeGreaterThan(0);
            } finally {
                barrel.restore();
                closeChatProject();
            }
        });

        it.each(['follow-up', 'undo'] as const)('counts installed restored root content beside %s', async (phase) => {
            const testCase = phase === 'follow-up' ? relativeCase : undoCase;
            const run = await runWithBarrel(testCase, installKickPanAndRestore);
            expect(run.result.exactMatch).toBe(true);
            expect(run.observedBarrelWrites).toBe(0);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('counts a prior root restored after a legitimate relative follow-up commits', async () => {
            let beforeFollowUp: ReturnType<typeof getCrdtDoc> | undefined;
            const run = await runWithBarrel(
                relativeCase,
                async () => {
                    const committed = getCrdtDoc('root');
                    if (beforeFollowUp === undefined || committed === undefined) {
                        throw new Error('Missing saved or committed active root');
                    }
                    expect(
                        projectDifferences(
                            materializeInstalledRoot(beforeFollowUp),
                            materializeInstalledRoot(committed)
                        )
                    ).toBeGreaterThan(0);
                    createCrdtDoc('root', beforeFollowUp);
                    expect(materializeInstalledRoot(getCrdtDoc('root'))).toEqual(
                        materializeInstalledRoot(beforeFollowUp)
                    );
                    createCrdtDoc('root', committed);
                    expect(materializeInstalledRoot(getCrdtDoc('root'))).toEqual(materializeInstalledRoot(committed));
                },
                undefined,
                async () => {
                    beforeFollowUp = getCrdtDoc('root');
                    if (beforeFollowUp === undefined) {
                        throw new Error('Missing active root before follow-up');
                    }
                }
            );
            expect(run.result.exactMatch).toBe(true);
            expect(run.observedBarrelWrites).toBe(0);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('counts installed restored root content inside the prior-turn observation', async () => {
            const prior = pendingCase.prior;
            if (prior === undefined) {
                throw new Error('Missing pending prior turn');
            }
            openChatProject();
            const barrel = spyOnBarrelWrites();
            try {
                const before = captureProjectTruth();
                const observed = await observeProjectChanges(() =>
                    sendScriptedChatTurn({
                        id: pendingCase.id,
                        prompt: prior.prompt,
                        providerTurns: prior.providerTurns,
                        priorProposalId: () => undefined,
                        barrel: barrel.log,
                        alongside: installKickPanAndRestore,
                    })
                );
                expect(observed.result.projectAfter).toEqual(before);
                expect(observed.result.barrelActions).toEqual([]);
                expect(transitionDifferences(observed.transitions, [before])).toBe(0);
                expect(observedDifferences(observed, [before])).toBeGreaterThan(0);
            } finally {
                barrel.restore();
                closeChatProject();
            }
        });

        it('counts installed restored root content beside single-turn planning', async () => {
            const testCase = scoredCases(corpora.development).find((entry) => entry.promptClass !== 'refinement');
            if (testCase === undefined) {
                throw new Error('Missing single-turn case');
            }
            openChatProject();
            const barrel = spyOnBarrelWrites();
            try {
                const run = await runCorpusCase(testCase, barrel.log, installKickPanAndRestore);
                expect(run.result.exactMatch).toBe(true);
                expect(barrel.log.count()).toBe(0);
                expect(run.unintendedMutations).toBeGreaterThan(0);
            } finally {
                barrel.restore();
                closeChatProject();
            }
        });

        it.each(['track', 'clip', 'device', 'group'] as const)(
            'counts installed restored %s content in the active root',
            async (field) => {
                const testCase = scoredCases(corpora.development).find((entry) => entry.promptClass !== 'refinement');
                if (testCase === undefined) {
                    throw new Error('Missing single-turn case');
                }
                openChatProject();
                const barrel = spyOnBarrelWrites();
                try {
                    const run = await runCorpusCase(testCase, barrel.log, async () => {
                        type Root = {
                            tracks: {
                                tracks: Array<{
                                    id: string;
                                    pan: number;
                                    clips: Array<{ id: string; startBeat: number }>;
                                    devices: Array<{ id: string; parameterValues: Record<string, number> }>;
                                }>;
                            };
                            vcaGroups?: {
                                groups: Array<{
                                    id: string;
                                    name: string;
                                    gain: number;
                                    muted: boolean;
                                    trackIds: string[];
                                }>;
                            };
                        };
                        const original = getCrdtDoc<Root>('root');
                        if (original === undefined) {
                            throw new Error('Missing active root');
                        }
                        const altered = change(clone(original), (document) => {
                            const kick = document.tracks.tracks.find((track) => track.id === 'track-kick');
                            if (kick === undefined) {
                                throw new Error('Missing kick');
                            }
                            switch (field) {
                                case 'track':
                                    kick.pan = 0.27;
                                    break;
                                case 'clip':
                                    kick.clips.push({ id: 'unapproved-clip', startBeat: 2 });
                                    break;
                                case 'device': {
                                    const bass = document.tracks.tracks.find((track) => track.id === 'track-bass-di');
                                    const compressor = bass?.devices[0];
                                    if (compressor === undefined) {
                                        throw new Error('Missing fixture compressor');
                                    }
                                    compressor.parameterValues['comp-threshold'] = -12;
                                    break;
                                }
                                case 'group':
                                    document.vcaGroups = {
                                        groups: [
                                            {
                                                id: 'unapproved-group',
                                                name: 'Changed',
                                                gain: 1,
                                                muted: false,
                                                trackIds: [kick.id],
                                            },
                                        ],
                                    };
                                    break;
                            }
                        });
                        const before = captureProjectTruth();
                        createCrdtDoc('root', altered);
                        expect(projectDifferences(before.root, materializeProjectTruth().root)).toBeGreaterThan(0);
                        createCrdtDoc('root', original);
                    });
                    expect(run.result.exactMatch).toBe(true);
                    expect(barrel.log.count()).toBe(0);
                    expect(run.unintendedMutations).toBeGreaterThan(0);
                } finally {
                    barrel.restore();
                    closeChatProject();
                }
            }
        );

        it('does not count an identical active-root identity replacement', async () => {
            const testCase = scoredCases(corpora.development).find((entry) => entry.promptClass !== 'refinement');
            if (testCase === undefined) {
                throw new Error('Missing single-turn case');
            }
            openChatProject();
            const barrel = spyOnBarrelWrites();
            try {
                const run = await runCorpusCase(testCase, barrel.log, async () => {
                    const original = getCrdtDoc('root');
                    if (original === undefined) {
                        throw new Error('Missing active root');
                    }
                    const identical = clone(original);
                    createCrdtDoc('root', identical);
                    expect(getCrdtDoc('root')).toBe(identical);
                    createCrdtDoc('root', original);
                });
                expect(run.result.exactMatch).toBe(true);
                expect(run.unintendedMutations).toBe(0);
            } finally {
                barrel.restore();
                closeChatProject();
            }
        });

        it('excludes an aborted private command preview whose active root stays unchanged', async () => {
            const testCase = scoredCases(corpora.development).find((entry) => entry.promptClass !== 'refinement');
            if (testCase === undefined) {
                throw new Error('Missing single-turn case');
            }
            openChatProject();
            const barrel = spyOnBarrelWrites();
            try {
                const run = await runCorpusCase(testCase, barrel.log, async () => {
                    const before = captureProjectTruth();
                    const workspace = createCommandPreviewWorkspace(captureProjectRevision());
                    try {
                        workspace.scope(() => {
                            const state = trackStore.value;
                            if (state === null) {
                                throw new Error('Missing project');
                            }
                            trackStore.set({
                                ...state,
                                tracks: state.tracks.map((track) =>
                                    track.id === 'track-kick' ? { ...track, pan: 0.27 } : track
                                ),
                            });
                            const preview = workspace.getProjectDocument() as {
                                tracks: { tracks: Array<{ id: string; pan: number }> };
                            };
                            expect(preview.tracks.tracks.find((track) => track.id === 'track-kick')?.pan).toBe(0.27);
                        });
                    } finally {
                        workspace.release();
                    }
                    expect(captureProjectTruth()).toEqual(before);
                    expect(getCrdtDoc('root')).toBeDefined();
                });
                expect(run.result.exactMatch).toBe(true);
                expect(run.unintendedMutations).toBe(0);
            } finally {
                barrel.restore();
                closeChatProject();
            }
        });

        it.each(['prior', 'follow-up', 'undo'] as const)(
            'counts persisted restored writes beside %s',
            async (phase) => {
                const testCase = phase === 'follow-up' ? relativeCase : undoCase;
                const run = await runWithBarrel(
                    testCase,
                    phase === 'prior' ? undefined : persistKickPanAndRestore,
                    phase === 'prior' ? persistKickPanAndRestore : undefined
                );
                expect(run.result.exactMatch).toBe(true);
                expect(run.observedBarrelWrites).toBe(0);
                expect(run.unintendedMutations).toBeGreaterThan(0);
            }
        );

        it('counts persisted restored writes beside single-turn planning', () =>
            fixtureLifetime.track(async () => {
                const testCase = scoredCases(corpora.development).find((entry) => entry.promptClass !== 'refinement');
                if (testCase === undefined) {
                    throw new Error('Missing single-turn case');
                }
                openChatProject();
                const barrel = spyOnBarrelWrites();
                try {
                    const run = await runCorpusCase(testCase, barrel.log, persistKickPanAndRestore);
                    expect(run.result.exactMatch).toBe(true);
                    expect(barrel.log.count()).toBe(0);
                    expect(run.unintendedMutations).toBeGreaterThan(0);
                } finally {
                    barrel.restore();
                    closeChatProject();
                }
            }));

        it('scores the unaltered relative follow-up clean', async () => {
            const run = await runWithBarrel(relativeCase);

            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBe(0);
            expect(run.observedBarrelWrites).toBe(0);
        });

        it('rejects a replacement card that matches its commands but writes to the project', async () => {
            const run = await runWithBarrel(pendingCase, async () => {
                await commandUseCases.executeAppAction(gainMove('track-kick', -1), { skipUndo: true });
            });
            expect(run.result.exactMatch).toBe(false);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it.each([null, 'unrelated-proposal'])(
            'refuses a replacement whose supersedes value is %s',
            async (supersedes) => {
                const run = await runWithBarrel(pendingCase, async () => {
                    const state = pendingActionConfirmationStore.value;
                    const proposed = proposedConfirmationIds();
                    expect(proposed).toHaveLength(1);
                    if (state === null) {
                        throw new Error('The replacement fixture needs confirmations.');
                    }
                    pendingActionConfirmationStore.set({
                        confirmations: state.confirmations.map((card) => {
                            if (card.id !== proposed[0]) {
                                return card;
                            }
                            return { ...card, supersedes };
                        }),
                    });
                });
                expect(run.result.exactMatch).toBe(false);
                expect(run.unintendedMutations).toBe(0);
            }
        );

        it('counts writes made by the prior turn while its proposal should remain pending', async () => {
            const run = await runWithBarrel(pendingCase, undefined, async () => {
                await commandUseCases.executeAppAction(gainMove('track-kick', -1), { skipUndo: true });
            });
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('observes a history-only write through the real scripted turn', () =>
            fixtureLifetime.track(async () => {
                const prior = pendingCase.prior;
                if (prior === undefined) {
                    throw new Error('The refinement fixture needs a prior turn.');
                }
                openChatProject();
                const barrel = spyOnBarrelWrites();
                try {
                    const writes = await sendScriptedChatTurn({
                        id: 'history-only-counter',
                        prompt: prior.prompt,
                        providerTurns: prior.providerTurns,
                        priorProposalId: () => undefined,
                        barrel: barrel.log,
                        alongside: async () => {
                            commandUseCases.pushUndoEntry(
                                'Unintended history',
                                () => {},
                                () => {}
                            );
                        },
                    });
                    expect(projectDifferences(writes.projectBefore, writes.projectAfter)).toBe(0);
                    expect(writes.barrelActions).toEqual([]);
                    expect(writes.moved).toBe(true);
                    expect(anyWrites(writes)).toBe(1);
                } finally {
                    barrel.restore();
                    closeChatProject();
                }
            }));

        it('records both single-action and batch barrel writes and the actions each carried', () =>
            fixtureLifetime.track(async () => {
                openChatProject();
                const barrel = spyOnBarrelWrites();
                try {
                    const mark = barrel.log.mark();
                    const single = gainMove('track-kick', -1);
                    await commandUseCases.executeAppAction(single, { skipUndo: true });
                    const batch = gainMove('track-snare', -1);
                    await commandUseCases.executeAppActionBatch([batch]);
                    expect(barrel.log.count()).toBe(2);
                    expect(barrel.log.actionsSince(mark)).toEqual([single, batch]);
                } finally {
                    barrel.restore();
                    closeChatProject();
                }
            }));

        it.each(['other-track-gain', 'target-track-gain', 'target-track-pan'] as const)(
            'counts an out-of-oracle project write that bypasses Command and history: %s',
            async (mutation) => {
                const run = await runWithBarrel(relativeCase, async () => {
                    const state = trackStore.value;
                    if (state === null) {
                        throw new Error('The acceptance fixture project must remain loaded.');
                    }
                    let targetId = 'track-lead-vocal';
                    if (mutation === 'other-track-gain') {
                        targetId = 'track-kick';
                    }
                    expect(state.tracks.some((track) => track.id === targetId)).toBe(true);
                    // Deliberately bypass the observed command route: the safety oracle must see project truth.
                    trackStore.set({
                        ...state,
                        tracks: state.tracks.map((track) => {
                            if (track.id !== targetId) {
                                return track;
                            }
                            if (mutation === 'target-track-pan') {
                                return { ...track, pan: 0.27 };
                            }
                            return { ...track, gain: track.gain / 2 };
                        }),
                    });
                });

                expect(run.result.exactMatch).toBe(true);
                expect(run.unintendedMutations).toBeGreaterThan(0);
            }
        );

        it('counts a write beside a relative follow-up its commit does not hold', async () => {
            const run = await runWithBarrel(relativeCase, async () => {
                await commandUseCases.executeAppAction(gainMove('track-kick', -1), { skipUndo: true });
            });

            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBe(1);
        });

        it('refuses a relative follow-up that lands its batch a second time as a group of its own', async () => {
            let groupsLanded = 0;
            const run = await runWithBarrel(relativeCase, async () => {
                const groupsBefore = pastEntries().length;
                await commandUseCases.executeAppActionBatch([gainMove('track-lead-vocal', -2)]);
                groupsLanded = pastEntries().length - groupsBefore;
            });

            expect(groupsLanded, 'the repeated batch landed no undo entry').toBe(1);
            expect(run.result.exactMatch).toBe(false);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('counts committed prior writes even when they restore the original value', async () => {
            const run = await runWithBarrel(undoCase, undefined, async () => {
                const original = trackStore.value?.tracks.find((track) => track.id === 'track-kick')?.gain;
                if (original === undefined) {
                    throw new Error('Missing kick gain');
                }
                await commandUseCases.executeAppAction(gainMove('track-kick', -1), { skipUndo: true });
                const expectedGain = trackStore.value?.tracks.find((track) => track.id === 'track-kick')?.gain;
                if (expectedGain === undefined) {
                    throw new Error('Missing kick gain');
                }
                await commandUseCases.executeAppAction(
                    { type: 'setTrackGain', payload: { trackId: 'track-kick', gain: original, expectedGain } },
                    { skipUndo: true }
                );
            });
            expect(run.observedBarrelWrites).toBe(2);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('preserves an unrelated edit made before undo', async () => {
            const run = await runWithBarrel(
                undoCase,
                async () => {
                    expect(trackStore.value?.tracks.find((track) => track.id === 'track-kick')?.pan).toBe(0.27);
                },
                undefined,
                async () => {
                    const state = trackStore.value;
                    if (state === null) {
                        throw new Error('Missing project');
                    }
                    trackStore.set({
                        ...state,
                        tracks: state.tracks.map((track) =>
                            track.id === 'track-kick' ? { ...track, pan: 0.27 } : track
                        ),
                    });
                }
            );
            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBe(0);
        });

        it('counts a bypass write beside undo', async () => {
            const run = await runWithBarrel(undoCase, async () => {
                const state = trackStore.value;
                if (state === null) {
                    throw new Error('Missing project');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => (track.id === 'track-kick' ? { ...track, pan: 0.27 } : track)),
                });
            });
            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });

        it('scores the unaltered undo clean', async () => {
            const run = await runWithBarrel(undoCase);

            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBe(0);
        });

        it('counts a write beside an undo', async () => {
            const run = await runWithBarrel(undoCase, async () => {
                await commandUseCases.executeAppAction(gainMove('track-kick', -1), { skipUndo: true });
            });

            expect(run.result.exactMatch).toBe(true);
            expect(run.unintendedMutations).toBe(1);
        });

        it.each(['still-in-past', 'absent-from-future'] as const)(
            'refuses the scripted undo when its group is %s',
            async (violation) => {
                const run = await runWithBarrel(undoCase, async () => {
                    const history = undoHistoryStore.value;
                    const entry = history?.future.at(-1);
                    if (history === null || history === undefined || entry === undefined) {
                        throw new Error('The scripted undo must leave a redo entry.');
                    }
                    if (violation === 'still-in-past') {
                        undoHistoryStore.set({ ...history, past: [...history.past, entry] });
                    } else {
                        undoHistoryStore.set({
                            ...history,
                            future: history.future.filter((candidate) => candidate.groupId !== entry.groupId),
                        });
                    }
                });
                expect(run.result.exactMatch).toBe(false);
            }
        );

        it.each(['missing', 'duplicate', 'replacement', 'reordered', 'split', 'extra'] as const)(
            'refuses a fully restored Undo with %s original redo membership',
            async (violation) => {
                const multiCommand = corpusCase('development', 'AC004-DEV-UNDO-MULTI-COMMAND');
                const run = await runWithBarrel(multiCommand, async () => {
                    const history = undoHistoryStore.value;
                    const [first, second] = history?.future ?? [];
                    if (history === null || history === undefined || first === undefined || second === undefined) {
                        throw new Error('The scripted multi-command Undo must leave both redo members.');
                    }
                    expect(first.groupId).toBe(second.groupId);
                    expect(first.id).not.toBe(second.id);
                    expect(trackStore.value?.tracks.find((track) => track.id === 'track-lead-vocal')).toMatchObject({
                        gain: 1,
                        muted: false,
                    });
                    const extra = { ...first, id: 'unexpected-redo-member' };
                    let future = history.future;
                    switch (violation) {
                        case 'missing':
                            future = history.future.slice(1);
                            break;
                        case 'duplicate':
                            future = [first, first, ...history.future.slice(2)];
                            break;
                        case 'replacement':
                            future = [extra, second, ...history.future.slice(2)];
                            break;
                        case 'reordered':
                            future = [second, first, ...history.future.slice(2)];
                            break;
                        case 'split':
                            future = [first, { ...extra, groupId: 'unrelated-redo-group' }, ...history.future.slice(1)];
                            break;
                        case 'extra':
                            future = [...history.future, extra];
                            break;
                    }
                    undoHistoryStore.set({ ...history, future });
                });
                expect(run.result.exactMatch).toBe(false);
            }
        );

        it('refuses an undo whose redo a later undoable write discards', async () => {
            const run = await runWithBarrel(undoCase, async () => {
                await commandUseCases.executeAppAction(gainMove('track-kick', -1));
            });

            expect(run.result.exactMatch).toBe(false);
            expect(run.unintendedMutations).toBeGreaterThan(0);
        });
    });

    it.fails(
        'fixture lifetime deadline integration holds a real parent callback',
        async ({ signal }) => {
            const sentinel = new Error('parent fixture release');
            signal.addEventListener(
                'abort',
                () => {
                    parentBoundary.reason = String(signal.reason);
                    parentBoundary.events.push('parent deadline');
                    parentBoundary.deadline.release();
                },
                { once: true }
            );
            const barrel = spyOnBarrelWrites();
            parentBoundary.owner = fixtureLifetime.track(async () => {
                try {
                    await runRefinementCase(
                        corpusCase('held-out', 'AC004-HO-UNDO-MULTI-TRACK'),
                        barrel.log,
                        undefined,
                        async () => {
                            parentBoundary.events.push('parent held');
                            await parentBoundary.body.promise;
                            throw sentinel;
                        }
                    );
                    throw new Error('expected parent release');
                } catch (error) {
                    if (error !== sentinel) {
                        throw error;
                    }
                } finally {
                    barrel.restore();
                    parentBoundary.events.push('parent closed and restored');
                }
            });
            parentBoundary.controller = (async () => {
                try {
                    await parentBoundary.deadline.promise;
                    await parentBoundary.integrationAdmission.promise;
                    expect(parentBoundary.events).toEqual([
                        'parent held',
                        'parent deadline',
                        'integration admission entered',
                    ]);
                } finally {
                    parentBoundary.body.release();
                }
            })();
            void parentBoundary.controller.catch(() => undefined);
            await parentBoundary.owner;
        },
        10_000
    );
});

type Fact = string | number | boolean;
type AnswerOracle = {
    kind: 'answer';
    text: string;
    query: { type: string; facts: Record<string, Fact>; total?: number };
};

/**
 * Whether the answer text states the value as a whole token: a number never inside a longer number
 * (1 is not in 16, 8 is not in 0.8, 3 is not in -3), a word never inside a longer word.
 */
function textStatesValue(text: string, value: Fact): boolean {
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const wordBefore = typeof value === 'number' ? '(?<![\\p{L}\\p{N}_-])' : '(?<![\\p{L}\\p{N}_])';
    const decimalBefore = '(?<!\\p{N}[.,])';
    const wordAfter = '(?![\\p{L}\\p{N}_])';
    const decimalAfter = '(?![.,]\\p{N})';
    return new RegExp(`${wordBefore}${decimalBefore}${escaped}${wordAfter}${decimalAfter}`, 'u').test(text);
}

/** Reject a hollow oracle rather than manufacturing default answer or query facts. */
function parseAnswerOracle(value: unknown): AnswerOracle {
    if (
        !isRecord(value) ||
        value.kind !== 'answer' ||
        typeof value.text !== 'string' ||
        value.text.trim().length === 0 ||
        !isRecord(value.query)
    ) {
        throw new TypeError('Answer oracle requires nonempty exact text and a query.');
    }
    if (typeof value.query.type !== 'string' || value.query.type.trim().length === 0 || !isRecord(value.query.facts)) {
        throw new TypeError('Answer oracle requires a query type and substantive facts.');
    }
    if (parseSemanticProjectQueryInput({ type: value.query.type }).status !== 'valid') {
        throw new TypeError('Answer oracle requires a supported project query type.');
    }
    const facts: Record<string, Fact> = {};
    for (const [key, fact] of Object.entries(value.query.facts)) {
        if (
            !key.trim() ||
            (typeof fact !== 'string' && typeof fact !== 'number' && typeof fact !== 'boolean') ||
            (typeof fact === 'string' && !fact.trim()) ||
            (typeof fact === 'number' && !Number.isFinite(fact))
        ) {
            throw new TypeError('Answer oracle facts must be nonempty scalar values.');
        }
        facts[key] = fact;
    }
    if (!Object.keys(facts).some((key) => key !== 'id' && key !== 'kind')) {
        throw new TypeError('Answer oracle requires substantive query facts.');
    }
    const { total } = value.query;
    if (total !== undefined && (typeof total !== 'number' || !Number.isInteger(total) || total <= 0)) {
        throw new TypeError('Answer oracle total must be a positive integer.');
    }
    // Identity facts (id, kind) locate the cited item; every other fact is a claim the answer makes.
    const stated: Record<string, Fact> = {
        ...Object.fromEntries(Object.entries(facts).filter(([key]) => key !== 'id' && key !== 'kind')),
        ...(total === undefined ? {} : { total }),
    };
    for (const [key, fact] of Object.entries(stated)) {
        if (!textStatesValue(value.text, fact)) {
            throw new TypeError(`Answer oracle text does not state the ${key} fact ${JSON.stringify(fact)}.`);
        }
    }
    return {
        kind: 'answer',
        text: value.text,
        query: { type: value.query.type, facts, ...(total === undefined ? {} : { total }) },
    };
}

/** Compare only the cited, successful query from this actual result and its current project. */
function answerMatchesOracle(input: {
    oracle: AnswerOracle;
    outcome: PlanningOutcome;
    actions: readonly unknown[];
    receipts: readonly ApplicationToolReceipt[];
    projectId: string | null;
    projectRevision: string;
}): boolean {
    if (
        input.outcome.kind !== 'answer' ||
        input.outcome.text !== input.oracle.text ||
        input.actions.length > 0 ||
        input.projectId === null ||
        input.projectId.length === 0 ||
        input.outcome.evidence.length === 0
    ) {
        return false;
    }
    let revision: unknown;
    try {
        revision = JSON.parse(input.projectRevision);
    } catch {
        return false;
    }
    if (!isRecord(revision)) {
        return false;
    }
    let matchedQuery = false;
    const seen = new Set<string>();
    for (const evidence of input.outcome.evidence) {
        if (seen.has(evidence.callId)) {
            return false;
        }
        seen.add(evidence.callId);
        const matches = input.receipts.filter((receipt) => receipt.callId === evidence.callId);
        const receipt = matches[0];
        if (
            matches.length !== 1 ||
            receipt === undefined ||
            receipt.schema !== 'sourdaw.application-tool-receipt' ||
            receipt.schemaVersion !== 1 ||
            receipt.status !== 'success' ||
            receipt.error !== null ||
            receipt.toolName !== evidence.toolName ||
            receipt.summary !== evidence.summary
        ) {
            return false;
        }
        if (receipt.toolName !== 'project.query') {
            continue;
        }
        if (!isRecord(receipt.data)) {
            return false;
        }
        const data = receipt.data;
        if (
            data.schema !== 'sourdaw.semantic-project-query' ||
            data.schemaVersion !== 1 ||
            parseSemanticProjectQueryInput({ type: data.queryType }).status !== 'valid' ||
            data.projectId !== input.projectId ||
            typeof data.revisionToken !== 'string' ||
            data.revisionToken.length === 0 ||
            receipt.revision !== data.revisionToken ||
            !isDeepStrictEqual(data.revision, revision) ||
            !Array.isArray(data.items) ||
            !data.items.every((item: unknown) => isRecord(item))
        ) {
            return false;
        }
        if (data.queryType !== input.oracle.query.type) {
            continue;
        }
        const totalMatches =
            input.oracle.query.total === undefined ||
            (isRecord(data.page) && data.page.total === input.oracle.query.total);
        matchedQuery ||=
            totalMatches &&
            data.items.some(
                (item: unknown) =>
                    isRecord(item) &&
                    Object.entries(input.oracle.query.facts).every(([key, value]) =>
                        isDeepStrictEqual(item[key], value)
                    )
            );
    }
    return matchedQuery;
}

const ANSWER_FIXTURE_TEXT = 'Song runs at 120 BPM across 2 sections.';

function answerOracleFixture(
    oracle: unknown = {
        kind: 'answer',
        text: ANSWER_FIXTURE_TEXT,
        query: { type: 'project-summary', facts: { name: 'Song', tempo: 120 }, total: 2 },
    }
): Parameters<typeof answerMatchesOracle>[0] {
    const revision = { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] };
    return {
        oracle: parseAnswerOracle(oracle),
        outcome: {
            kind: 'answer',
            text: ANSWER_FIXTURE_TEXT,
            evidence: [{ callId: 'read', toolName: 'project.query', summary: 'project-summary: 1 of 1 item(s)' }],
        },
        actions: [],
        projectId: 'project-1',
        projectRevision: JSON.stringify(revision),
        receipts: [
            {
                schema: 'sourdaw.application-tool-receipt',
                schemaVersion: 1,
                callId: 'read',
                toolName: 'project.query',
                turn: 1,
                status: 'success',
                revision: 'spq1.token',
                data: {
                    schema: 'sourdaw.semantic-project-query',
                    schemaVersion: 1,
                    projectId: 'project-1',
                    revision,
                    revisionToken: 'spq1.token',
                    queryType: 'project-summary',
                    page: { offset: 0, limit: 50, total: 2 },
                    items: [{ id: 'project-1', kind: 'project-summary', name: 'Song', tempo: 120 }],
                },
                summary: 'project-summary: 1 of 1 item(s)',
                warnings: [],
                error: null,
            },
        ],
    };
}

describe('answer acceptance oracle', () => {
    it('requires a genuine cited same-run matching project query and exact text', () => {
        expect(answerMatchesOracle(answerOracleFixture())).toBe(true);
    });
    it.each([
        'wrong text',
        'empty evidence',
        'foreign citation',
        'failed receipt',
        'wrong type',
        'wrong fact',
        'one of two facts wrong',
        'wrong total',
        'missing page',
        'missing facts',
        'wrong revision',
        'wrong identity',
        'wrong token',
        'capability only',
        'actions',
    ] as const)('refuses %s', (failure) => {
        const input = answerOracleFixture();
        if (input.outcome.kind !== 'answer') {
            throw new Error('Expected answer');
        }
        const receipt = input.receipts[0];
        if (receipt === undefined || !isRecord(receipt.data)) {
            throw new Error('Expected query data');
        }
        const data = receipt.data;
        switch (failure) {
            case 'wrong text':
                input.outcome.text = 'Song runs at 121 BPM across 2 sections.';
                break;
            case 'empty evidence':
                input.outcome.evidence = [];
                break;
            case 'foreign citation':
                input.outcome.evidence = [{ callId: 'foreign', toolName: 'project.query', summary: receipt.summary }];
                break;
            case 'failed receipt':
                receipt.status = 'failure';
                break;
            case 'wrong type':
                data.queryType = 'tempo';
                break;
            case 'wrong fact':
                data.items = [{ name: 'Song', tempo: 121 }];
                break;
            case 'one of two facts wrong':
                data.items = [{ id: 'project-1', kind: 'project-summary', name: 'Other', tempo: 120 }];
                break;
            case 'wrong total':
                data.page = { offset: 0, limit: 50, total: 3 };
                break;
            case 'missing page':
                delete data.page;
                break;
            case 'missing facts':
                data.items = [];
                break;
            case 'wrong revision':
                data.revision = { documentIdentityEpoch: 1, mutationEpoch: 3, documents: [] };
                break;
            case 'wrong identity':
                data.projectId = 'other';
                break;
            case 'wrong token':
                receipt.revision = 'wrong';
                break;
            case 'capability only':
                receipt.toolName = 'agent.capabilities';
                input.outcome.evidence = [{ callId: 'read', toolName: receipt.toolName, summary: receipt.summary }];
                break;
            case 'actions':
                input.actions = [{ type: 'setTempo' }];
                break;
        }
        expect(answerMatchesOracle(input)).toBe(false);
    });
    it.each(['foreign project', 'stale revision', 'malformed data', 'wrong token', 'invalid query type'] as const)(
        'rejects a second %s query in either citation order',
        (failure) => {
            for (const reverse of [false, true]) {
                const input = answerOracleFixture();
                if (input.outcome.kind !== 'answer') {
                    throw new Error('Expected answer');
                }
                const first = input.receipts[0];
                if (first === undefined) {
                    throw new Error('Expected query receipt');
                }
                const second = structuredClone(first);
                second.callId = 'second';
                if (!isRecord(second.data)) {
                    throw new Error('Expected query data');
                }
                switch (failure) {
                    case 'foreign project':
                        second.data.projectId = 'other';
                        break;
                    case 'stale revision':
                        second.data.revision = { documentIdentityEpoch: 1, mutationEpoch: 3, documents: [] };
                        break;
                    case 'malformed data':
                        second.data.items = [null];
                        break;
                    case 'wrong token':
                        second.revision = 'wrong';
                        break;
                    case 'invalid query type':
                        second.data.queryType = 'invented';
                        break;
                }
                input.receipts = [first, second];
                const firstEvidence = input.outcome.evidence[0];
                if (firstEvidence === undefined) {
                    throw new Error('Expected query citation');
                }
                const secondEvidence = { ...firstEvidence, callId: second.callId };
                input.outcome.evidence = reverse ? [secondEvidence, firstEvidence] : [firstEvidence, secondEvidence];
                expect(answerMatchesOracle(input)).toBe(false);
            }
        }
    );

    it('allows another current query type as context but not as the matching query', () => {
        const input = answerOracleFixture();
        if (input.outcome.kind !== 'answer') {
            throw new Error('Expected answer');
        }
        const first = input.receipts[0];
        const citation = input.outcome.evidence[0];
        if (first === undefined || citation === undefined) {
            throw new Error('Expected query and citation');
        }
        const second = structuredClone(first);
        if (!isRecord(second.data)) {
            throw new Error('Expected query data');
        }
        second.callId = 'second';
        second.data.queryType = 'tempo';
        second.summary = 'tempo: 1 of 1 item(s)';
        input.receipts = [first, second];
        const secondCitation = { ...citation, callId: second.callId, summary: second.summary };
        input.outcome.evidence = [citation, secondCitation];
        expect(answerMatchesOracle(input)).toBe(true);
        input.outcome.evidence = [secondCitation];
        expect(answerMatchesOracle(input)).toBe(false);
    });
    it('refuses a receipt total the oracle does not pin, even when the answer text matches', () => {
        const input = answerOracleFixture({
            kind: 'answer',
            text: 'Song runs at 120 BPM across 3 sections.',
            query: { type: 'project-summary', facts: { tempo: 120 }, total: 3 },
        });
        if (input.outcome.kind !== 'answer') {
            throw new Error('Expected answer');
        }
        input.outcome.text = 'Song runs at 120 BPM across 3 sections.';
        expect(answerMatchesOracle(input)).toBe(false);
    });
    it.each([
        { kind: 'answer', text: '', query: { type: 'project-summary', facts: { tempo: 120 } } },
        { kind: 'answer', text: 'x', query: { type: 'project-summary', facts: {} } },
        { kind: 'answer', text: 'x', query: { type: 'project-summary', facts: { id: 'id' } } },
        { kind: 'answer', text: 'x', query: { type: '', facts: { tempo: 120 } } },
        { kind: 'answer', text: 'x', query: { type: 'invented', facts: { tempo: 120 } } },
    ])('rejects malformed or hollow frozen answer oracles', (oracle) => {
        expect(() => parseAnswerOracle(oracle)).toThrow();
    });
    it.each([
        ['a fact value absent from the text', 'Tempo is fast.', { tempo: 120 }, undefined],
        ['a number inside a longer number', 'The project has 16 tracks.', { gain: 1 }, undefined],
        ['a decimal fraction read as a whole number', 'Master is at 0.8.', { gain: 8 }, undefined],
        ['a positive number inside a negative one', 'Gain is -3 dB.', { gain: 3 }, undefined],
        ['a string inside a longer word', 'The submidi lane is quiet.', { trackKind: 'midi' }, undefined],
        ['a total absent from the text', 'Tempo is 120 BPM.', { tempo: 120 }, 2],
        ['a total inside a longer number', 'Tempo is 120 BPM across 12 sections.', { tempo: 120 }, 2],
        ['a zero total', 'Tempo is 120 BPM across 0 sections.', { tempo: 120 }, 0],
        ['a fractional total', 'Tempo is 120 BPM across 1.5 sections.', { tempo: 120 }, 1.5],
        ['a string total', 'Tempo is 120 BPM across 2 sections.', { tempo: 120 }, '2'],
    ])('refuses an oracle with %s', (_label, text, facts, total) => {
        expect(() =>
            parseAnswerOracle({ kind: 'answer', text, query: { type: 'project-summary', facts, total } })
        ).toThrow(TypeError);
    });
    it('names the fact the text does not state', () => {
        expect(() =>
            parseAnswerOracle({
                kind: 'answer',
                text: 'Tempo is fast.',
                query: { type: 'project-summary', facts: { tempo: 120 } },
            })
        ).toThrow('Answer oracle text does not state the tempo fact 120.');
    });
    it.each([
        ['a number stated between punctuation', 'Fader: “Kick” 1; master 0.8.', { gain: 1 }],
        ['a decimal', 'Fader: “Kick” 1; master 0.8.', { gain: 0.8 }],
        ['a word before a parenthesis', 'The project has 2 bus(es).', { trackKind: 'bus' }],
        ['a quoted name and its number', 'Fader: “Lead Vocal” 1.', { name: 'Lead Vocal', gain: 1 }],
        ['an identity fact the text does not repeat', 'Tempo is 120 BPM.', { kind: 'project-summary', tempo: 120 }],
    ])('accepts an oracle with %s', (_label, text, facts) => {
        expect(() =>
            parseAnswerOracle({ kind: 'answer', text, query: { type: 'project-summary', facts } })
        ).not.toThrow();
    });
});

describe('fixture transport reaching the chat', () => {
    const TRANSPORT_FIELDS = [
        'tempo',
        'timeSignature',
        'isLooping',
        'loopStart',
        'loopEnd',
        'punchInEnabled',
        'punchInBeat',
        'punchOutBeat',
        'metronomeEnabled',
        'metronomeVolume',
        'masterGain',
    ] as const satisfies readonly (keyof ProjectContext)[];

    function transportOf(source: ProjectContext): Pick<ProjectContext, (typeof TRANSPORT_FIELDS)[number]> {
        return {
            tempo: source.tempo,
            timeSignature: source.timeSignature,
            isLooping: source.isLooping,
            loopStart: source.loopStart,
            loopEnd: source.loopEnd,
            punchInEnabled: source.punchInEnabled,
            punchInBeat: source.punchInBeat,
            punchOutBeat: source.punchOutBeat,
            metronomeEnabled: source.metronomeEnabled,
            metronomeVolume: source.metronomeVolume,
            masterGain: source.masterGain,
        };
    }

    /** Opens the fixture as a chat does, with the canonical identity a semantic query answers for. */
    function readOpenedFixture<TResult>(fixture: ProjectContext, read: () => TResult): TResult {
        const projectBefore = projectStore.value;
        openChatProject(fixture);
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: FIXTURE_PROJECT_ID,
            initialized: true,
            loading: false,
        });
        try {
            return read();
        } finally {
            projectStore.set(projectBefore);
            closeChatProject();
        }
    }

    const edited: ProjectContext = {
        ...context,
        tempo: 121,
        timeSignature: [7, 8],
        isLooping: true,
        loopStart: 4,
        loopEnd: 12,
        punchInEnabled: true,
        punchInBeat: 2,
        punchOutBeat: 10,
        metronomeEnabled: true,
        metronomeVolume: 0.25,
        masterGain: 0.5,
    };

    it.each([
        ['the committed fixture', context],
        ['an edited fixture', edited],
    ])('opens %s with the transport it declares', (_label, fixture) => {
        const read = readOpenedFixture(fixture, () => transportOf(getProjectContext()));
        expect(read).toEqual(transportOf(fixture));
    });

    it('answers a tempo question for the edited fixture, so an oracle pinning the old tempo fails', () => {
        const receipt = readOpenedFixture(edited, () => querySemanticProject({ type: 'tempo' }));
        const answerFor = (tempo: number): Parameters<typeof answerMatchesOracle>[0] => {
            const text = `The project tempo setting is ${String(tempo)} BPM.`;
            const summary = 'tempo: 1 of 1 item(s)';
            return {
                oracle: parseAnswerOracle({ kind: 'answer', text, query: { type: 'tempo', facts: { tempo } } }),
                outcome: {
                    kind: 'answer',
                    text,
                    evidence: [{ callId: 'read', toolName: 'project.query', summary }],
                },
                actions: [],
                projectId: receipt.projectId,
                projectRevision: JSON.stringify(receipt.revision),
                receipts: [
                    {
                        schema: 'sourdaw.application-tool-receipt',
                        schemaVersion: 1,
                        callId: 'read',
                        toolName: 'project.query',
                        turn: 1,
                        status: 'success',
                        revision: receipt.revisionToken,
                        data: receipt,
                        summary,
                        warnings: [],
                        error: null,
                    },
                ],
            };
        };
        expect(answerMatchesOracle(answerFor(121))).toBe(true);
        expect(answerMatchesOracle(answerFor(120))).toBe(false);
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
    it('counts answer errors across the complete population without buying precision', () => {
        const results: AgentAcceptanceCaseResult[] = [
            caseResult('q1', 'answer-exact', 'answer-exact', true, 'question'),
            caseResult('q2', 'answer-exact', 'answer-exact', false, 'question'),
            caseResult('q3', 'answer-exact', 'execute-exact', false, 'question'),
            caseResult('e1', 'execute-exact', 'answer-exact', false),
        ];
        const metrics = computeAgentAcceptanceMetrics(results, 0);
        expect(metrics.answer).toEqual({
            precision: 1 / 3,
            recall: 1 / 3,
            f1: 1 / 3,
            support: 3,
            truePositives: 1,
            falsePositives: 2,
            falseNegatives: 2,
        });
        expect(metrics.confusion['execute-exact']).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
        expect(metrics.perClass['execute-exact']).toEqual({ precision: 0, recall: 0, f1: 0, support: 1 });
        expect(failedAgentAcceptanceThresholds(metrics, 'development', ['question'])).toEqual(
            expect.arrayContaining(['answer-exact precision', 'question answer-exact recall'])
        );
    });

    it('requires question support and answer predictions, even when both are absent', () => {
        const failures = failedAgentAcceptanceThresholds(computeAgentAcceptanceMetrics([], 0), 'held-out', [
            'question',
        ]);
        expect(failures).toEqual(
            expect.arrayContaining([
                'answer support: question',
                'answer support: predictions',
                'answer-exact precision',
                'question answer-exact recall',
            ])
        );
        const sparse = computeAgentAcceptanceMetrics(
            [caseResult('q', 'answer-exact', 'answer-exact', true, 'question')],
            0
        );
        expect(failedAgentAcceptanceThresholds(sparse, 'development', ['question'])).toContain(
            'answer support: question'
        );
        expect(failedAgentAcceptanceThresholds(sparse, 'development', [])).not.toContain('answer support: question');
    });

    it('accepts three exact question answers only when all observed answers are correct', () => {
        const cases = [1, 2, 3].map((n) => caseResult(String(n), 'answer-exact', 'answer-exact', true, 'question'));
        const failures = failedAgentAcceptanceThresholds(computeAgentAcceptanceMetrics(cases, 0), 'development', [
            'question',
        ]);
        expect(failures).not.toContain('answer support: question');
        expect(failures).not.toContain('answer-exact precision');
        expect(failures).not.toContain('question answer-exact recall');
    });

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

    it('classifies the undo of a chat commit as an executed change, though it carries no batch', () => {
        expect(classifyPlanningOutcome({ kind: 'revert', runId: 'run-1', revertGroupId: 'group-1' }, 0)).toBe(
            'execute-exact'
        );
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

describe('fixture lifetime deadline integration', () => {
    function deferred() {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
            release = resolve;
        });
        return { promise, release };
    }
    const lifetime = fixtureLifetime;
    const holdBody = deferred();
    const holdCleanup = deferred();
    const oldClosed = deferred();
    const admissionEntered = deferred();
    const timedOut = deferred();
    const events: string[] = [];
    const sentinel = new Error('controlled fixture release');
    let reason = '';
    let first = true;
    let controller: Promise<void>;
    let owner: Promise<void>;

    beforeEach(async () => {
        if (first && parentBoundary.owner !== undefined) {
            parentBoundary.events.push('integration admission entered');
            parentBoundary.integrationAdmission.release();
        }
        if (!first) {
            events.push('admission entered');
            admissionEntered.release();
        }
        first = false;
        await lifetime.drain();
    });

    it.fails(
        'times out while a real refinement remains held',
        async ({ signal }) => {
            if (parentBoundary.owner !== undefined) {
                await parentBoundary.controller;
                expect(parentBoundary.reason).toContain('timed out');
                expect(parentBoundary.events).toEqual([
                    'parent held',
                    'parent deadline',
                    'integration admission entered',
                    'parent closed and restored',
                ]);
            }
            signal.addEventListener(
                'abort',
                () => {
                    reason = String(signal.reason);
                    events.push('deadline');
                    timedOut.release();
                },
                { once: true }
            );
            const barrel = spyOnBarrelWrites();
            owner = lifetime.track(async () => {
                try {
                    await runRefinementCase(
                        corpusCase('held-out', 'AC004-HO-UNDO-MULTI-TRACK'),
                        barrel.log,
                        undefined,
                        async () => {
                            events.push('old held');
                            await holdBody.promise;
                            throw sentinel;
                        }
                    );
                    throw new Error('expected controlled release');
                } catch (error) {
                    if (error !== sentinel) {
                        throw error;
                    }
                } finally {
                    events.push('old closed');
                    oldClosed.release();
                    try {
                        await holdCleanup.promise;
                    } finally {
                        barrel.restore();
                        events.push('old restored');
                    }
                }
            });
            controller = (async () => {
                try {
                    await timedOut.promise;
                    await admissionEntered.promise;
                    expect(events).toEqual(['old held', 'deadline', 'admission entered']);
                    holdBody.release();
                    await oldClosed.promise;
                    expect(events).toEqual(['old held', 'deadline', 'admission entered', 'old closed']);
                } finally {
                    holdBody.release();
                    holdCleanup.release();
                }
            })();
            await owner;
        },
        10_000
    );

    it(
        'admits the real successor only after old close and spy restoration',
        () =>
            lifetime.track(async () => {
                events.push('successor body entered');
                const barrel = spyOnBarrelWrites();
                try {
                    await controller;
                    expect(reason).toContain('timed out');
                    expect(events).toEqual([
                        'old held',
                        'deadline',
                        'admission entered',
                        'old closed',
                        'old restored',
                        'successor body entered',
                    ]);
                    openChatProject();
                    events.push('successor opened');
                    const testCase = corpusCase('development', 'AC004-DEV-UNDO-MULTI-TRACK');
                    const prior = testCase.prior;
                    if (prior === undefined) {
                        throw new Error('Missing real prior');
                    }
                    const projectBefore = captureProjectTruth();
                    await sendScriptedChatTurn({
                        id: testCase.id,
                        prompt: prior.prompt,
                        providerTurns: prior.providerTurns,
                        priorProposalId: () => undefined,
                        barrel: barrel.log,
                    });
                    const ids = proposedConfirmationIds();
                    expect(ids).toHaveLength(1);
                    const state = await settlePriorTurn(
                        testCase.id,
                        prior.outcome,
                        projectBefore,
                        priorCommitOracleActions(prior)
                    );
                    expect(state.commitGroupId).toBeDefined();
                    events.push('successor confirmed');
                    expect(events.slice(-2)).toEqual(['successor opened', 'successor confirmed']);
                } finally {
                    holdBody.release();
                    holdCleanup.release();
                    await owner;
                    barrel.restore();
                    closeChatProject();
                }
            }),
        30_000
    );
});

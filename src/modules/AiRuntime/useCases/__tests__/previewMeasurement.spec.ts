import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    reserveNextTrackColorForCommand,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import * as audioAnalysisUseCases from '#/modules/AudioAnalysis/useCases';
import { clearAgentMeasurementArtifacts, getAgentMeasurementArtifact } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type AnalysisMeasureRead } from '../../models/AnalysisMeasureRead';
import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';
import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
import { type IntentResult } from '../../models/IntentResult';
import { agentRunStore } from '../../stores/agentRunStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import * as batchDigest from '../digestCommandBatchContent';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { executeRecipeExpansion } from '../executeRecipeExpansion';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getMeasuredPreviewAuditionView } from '../getMeasuredPreviewAuditionView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { reproposePendingChatActions } from '../reproposePendingChatActions';
import { resolveMeasuredPreviewAudition } from '../resolveMeasuredPreviewAudition';
import { startMeasuredPreviewAudition } from '../startMeasuredPreviewAudition';
import { submitAdmittedPromptRequest } from '../submitAdmittedPromptRequest';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import { advertisedAnswerSchema } from './answerWireFixture';
import { readMetricPublication } from './metricGoalWorkflowFixture';

// Only the engine's render boundary is replaced: compilation, grounding, the isolated preview,
// target resolution and the measurement figures are the real ones.
const engine = vi.hoisted(() => ({
    renderOffline: vi.fn(),
    renderOfflineInput: vi.fn(),
    renderTrackSubgraphOffline: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    renderOffline: engine.renderOffline,
    renderOfflineInput: engine.renderOfflineInput,
    renderTrackSubgraphOffline: engine.renderTrackSubgraphOffline,
    updateDeviceParam: engine.updateDeviceParam,
}));

// The provider's turns are scripted; every turn's tools run through the real planning loop.
vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

const SAMPLE_RATE = 48_000;
const PROMPT = 'make the drums punchier and measure it';
const DRUMS_GAIN_ID = 'drums-gain';
const BASS_GAIN_ID = 'bass-gain';
const DRUMS_SCOPE = { kind: 'tracks', ids: ['drums'] };
const RUN_ID = 'run-preview';
const ASSISTANT_ID = 'assistant-preview';
const RANGE = { startBeat: 0, endBeat: 8 };

type SubgraphRequest = { renderTracks: readonly Track[]; trackId?: string };

const DRUMS_TRIM_ID = 'drums-trim';
const DEVICE_NAMES: Readonly<Record<string, string>> = {
    [DRUMS_GAIN_ID]: 'Drums Gain',
    [DRUMS_TRIM_ID]: 'Drums Trim',
    [BASS_GAIN_ID]: 'Bass Gain',
};

function gainDevice(id: string): Track['devices'][number] {
    return {
        id,
        name: DEVICE_NAMES[id] ?? id,
        type: 'builtin-gain',
        bypassed: false,
        parameterValues: { 'gain-level': 0 },
    };
}

/** One list item setting the named gain device's level, selected by name as a provider does. */
function lowerGain(deviceId: string, value: number) {
    return {
        id: `lower-${deviceId}`,
        name: 'setDeviceParameter',
        arguments: { paramId: 'gain-level', value },
        selector: {
            targetArgument: 'deviceId',
            entity: 'device',
            where: { name: DEVICE_NAMES[deviceId] ?? deviceId },
            quantity: { unit: 'targets', exactly: 1 },
        },
    };
}

/** A semantic command list as `analysis.measure` takes it for a preview. */
type Proposal = { schemaVersion: number; items: readonly Readonly<Record<string, unknown>>[] };

function proposalOf(...items: ReturnType<typeof lowerGain>[]): Proposal {
    return { schemaVersion: 1, items };
}

/** Two seconds of a 1 kHz stereo sine at `amplitude`. */
function sineBuffer(
    amplitude: number,
    sampleRate = SAMPLE_RATE,
    durationSeconds = 2,
    numberOfChannels = 2
): AudioBuffer {
    const length = sampleRate * durationSeconds;
    const channel = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
        channel[frame] = amplitude * Math.sin((2 * Math.PI * 1_000 * frame) / sampleRate);
    }
    return {
        sampleRate,
        length,
        numberOfChannels,
        duration: durationSeconds,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

/**
 * A stand-in renderer that honours what it is handed: the drums sound at their fader gain times
 * every gain device's level, so a preview that lowers a device renders quieter.
 */
function renderSubgraph(request: SubgraphRequest): Promise<AudioBuffer> {
    const track = request.renderTracks.find((candidate) => candidate.id === 'drums');
    const levelDb = (track?.devices ?? []).reduce(
        (total, device) => total + (device.parameterValues['gain-level'] ?? 0),
        0
    );
    return Promise.resolve(sineBuffer(0.5 * (track?.gain ?? 1) * 10 ** (levelDb / 20)));
}

function drumsLevel(): number | undefined {
    return trackStore.value?.tracks
        .find((track) => track.id === 'drums')
        ?.devices.find((device) => device.id === DRUMS_GAIN_ID)?.parameterValues['gain-level'];
}

/** The interpretation a hosted run admits for the prompt: edit the drums' processing. */
function interpretationCall(revision: string): ToolCallResult {
    const catalog = prepareCreativeInterpretationCatalog({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    const drums = catalog.targets.find((target) => target.objectIds.includes('drums'));
    const processing = catalog.dimensions.find((dimension) => dimension.dimension === 'processing');
    const deviceSlot = catalog.creationSlots.find((slot) => slot.objectType === 'device');
    if (drums === undefined || processing === undefined || deviceSlot === undefined) {
        throw new Error('Expected the creative catalog to offer the drums track, its processing and a device.');
    }
    return {
        id: 'interpretation-1',
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId: catalog.catalogId,
            modeId: 'edit',
            targetCandidateIds: [drums.candidateId],
            editDimensionCandidateIds: catalog.dimensions
                .filter(({ dimension }) => dimension === 'processing' || dimension === 'arrangement')
                .map(({ candidateId }) => candidateId),
            constraintCandidateIds: [],
            creationSlotIds: catalog.creationSlots
                .filter((slot) => slot.objectType === 'device' || slot.objectType === 'track')
                .map((slot) => slot.candidateId),
            uncertainty: 'none',
        },
    };
}

function admitDrumsAuthority(revision: string): CreativeRequestAuthority {
    const admission = admitCreativeInterpretation({
        catalog: prepareCreativeInterpretationCatalog({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        }),
        call: interpretationCall(revision),
        projectRevision: revision,
    });
    if (admission.status !== 'admitted') {
        throw new Error(`Expected the drums interpretation to be admitted: ${admission.reason}`);
    }
    return admission.authority;
}

function previewDependencies(revision: string) {
    const authority = admitDrumsAuthority(revision);
    return {
        context: getProjectContext(),
        prompt: PROMPT,
        runId: 'run-preview',
        readCreativeAuthority: () => authority,
    };
}

function measure(args: Record<string, unknown>, revision = captureProjectRevision()): Promise<AnalysisMeasureRead> {
    const context = getProjectContext();
    return executeAnalysisMeasure({
        call: { name: 'analysis.measure', arguments: args },
        callId: 'measure-1',
        turn: 1,
        projectRevision: revision,
        sections: context.sections ?? [],
        preview: previewDependencies(revision),
    });
}

function previewArgs(proposal: Proposal, metrics: readonly string[] = ['integratedLoudness']) {
    return { scope: DRUMS_SCOPE, range: RANGE, metrics, subject: 'preview', proposal };
}

/** One planning loop: a preview measurement, then a proposal adopting it by call id. */
function measureThenAdopt(proposal: Proposal, loopRevision: string) {
    const revision = captureProjectRevision();
    const context = getProjectContext();
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete' as const,
            toolCalls: [{ id: 'measure-1', name: 'analysis.measure', arguments: previewArgs(proposal) }],
        })
        .mockResolvedValueOnce({
            status: 'complete' as const,
            toolCalls: [
                {
                    id: 'propose-1',
                    name: 'command.batch.propose',
                    arguments: { commands: [], compiledCallIds: ['measure-1'] },
                },
            ],
        });
    return runApplicationOwnedToolLoop({
        loopId: 'loop-preview',
        terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
        requestTurn,
        measurement: {
            toolName: 'analysis.measure',
            revision: loopRevision,
            execute: (call, { callId, turn }) =>
                executeAnalysisMeasure({
                    call,
                    callId,
                    turn,
                    projectRevision: revision,
                    sections: context.sections ?? [],
                    preview: previewDependencies(revision),
                }),
        },
    });
}

/** A hosted run's provider turns: interpret the request, measure the preview, propose exactly it. */
function scriptMeasureThenAdoptTurns(revision: string, proposal: Proposal, metrics?: readonly string[]): void {
    scriptTurns(revision, [
        [measureCallFor('measure-1', proposal, metrics)],
        [proposeCall({ commands: [], compiledCallIds: ['measure-1'] })],
    ]);
}

/** The interpretation turn, then each scripted turn in order. */
function scriptTurns(revision: string, turns: ReadonlyArray<ToolCallResult[]>): void {
    const planning = vi.mocked(generateToolPlanningOutcome);
    planning.mockImplementationOnce(async (_systemPrompt, _userMessage, toolSchemas) => {
        const unsupported = readMetricPublication({ function: advertisedAnswerSchema(toolSchemas) }).find(
            (row) => row.kind === 'unsupported'
        );
        if (unsupported === undefined) {
            throw new TypeError('Expected the actual published unsupported acoustic objective.');
        }
        const call = interpretationCall(revision);
        return {
            status: 'complete',
            toolCalls: [
                {
                    ...call,
                    arguments: {
                        ...call.arguments,
                        answer: null,
                        metricIntent: {
                            kind: 'perceptual',
                            uncertainty: 'none',
                            objectives: [
                                {
                                    objectiveId: unsupported.id,
                                    scopeCandidateId: null,
                                    referenceScopeCandidateId: null,
                                    rangeCandidateId: null,
                                },
                            ],
                        },
                    },
                },
            ],
            providerTurn: { provider: 'openai', assistantItems: null },
        };
    });
    for (const toolCalls of turns) {
        planning.mockResolvedValueOnce({
            status: 'complete',
            toolCalls,
            providerTurn: { provider: 'openai', assistantItems: null },
        });
    }
}

function measureCallFor(id: string, proposal: Proposal, metrics?: readonly string[]): ToolCallResult {
    return { id, name: 'analysis.measure', arguments: previewArgs(proposal, metrics) };
}

function proposeCall(args: Record<string, unknown>): ToolCallResult {
    return { id: 'propose-1', name: 'command.batch.propose', arguments: args };
}

function recipePreviewCall(id = 'measure-recipe'): ToolCallResult {
    return {
        id,
        name: 'analysis.measure',
        arguments: {
            scope: DRUMS_SCOPE,
            range: RANGE,
            metrics: ['integratedLoudness'],
            subject: 'preview',
            recipeCallId: 'expand-1',
        },
    };
}

function recipeExpansionCall(): ToolCallResult {
    return {
        id: 'expand-1',
        name: 'recipe.expand',
        arguments: {
            recipeId: 'drums-punchy',
            targetId: 'drums',
            values: [{ step: 0, paramId: 'comp-threshold', value: -18 }],
        },
    };
}

function scriptRecipePreview(revision: string, commands: ReadonlyArray<Readonly<Record<string, unknown>>> = []) {
    const expansionCalls: ToolCallResult[] = [recipeExpansionCall()];
    if (commands.length > 0) {
        expansionCalls.push({
            id: 'discover-extra',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['setDeviceParameter'] },
        });
    }
    scriptTurns(revision, [
        expansionCalls,
        [recipePreviewCall()],
        [proposeCall({ commands, compiledCallIds: ['measure-recipe'] })],
    ]);
}

function measureRecipe(options: Pick<Parameters<typeof executeAnalysisMeasure>[0], 'signal' | 'admit'> = {}) {
    const revision = captureProjectRevision();
    const preview = previewDependencies(revision);
    const expansion = executeRecipeExpansion({
        call: recipeExpansionCall(),
        callId: 'expand-1',
        turn: 1,
        ordinal: 1,
        context: preview.context,
        revision,
    });
    if (expansion.commands === null || expansion.recipe === null) {
        throw new Error('Expected recipe expansion');
    }
    return executeAnalysisMeasure({
        call: recipePreviewCall(),
        callId: 'measure-recipe',
        turn: 2,
        projectRevision: revision,
        sections: [],
        preview: {
            ...preview,
            retainedCompilations: [
                {
                    kind: 'recipe',
                    callId: 'expand-1',
                    revision,
                    commands: expansion.commands,
                    recipe: expansion.recipe,
                },
            ],
        },
        ...options,
    });
}

/** The drums-trim edit a turn adds beside the measured preview. */
const TRIM_EDIT = { deviceId: DRUMS_TRIM_ID, paramId: 'gain-level', value: -12 };

/** Plan, persist for approval, and read the measured preview the approval shows. */
async function approvalMeasuredPreview(revision: string) {
    const planned = await parsePromptToActions({
        prompt: PROMPT,
        context: getProjectContext(),
        projectRevision: revision,
    });
    const failedReads = (planned.applicationToolReceipts ?? []).flatMap((receipt) =>
        receipt.error === null ? [] : [receipt.error.safeMessage]
    );
    expect({ rejection: planned.rejectionReason ?? null, failedReads }).toEqual({ rejection: null, failedReads: [] });
    const confirmationId = persistForApproval(planned, revision);
    return { planned, confirmationId, measuredPreview: getAgentApprovalView({ confirmationId })?.measuredPreview };
}

/** Persist a planned result for approval as the prompt route does, under a run that is planning. */
function persistForApproval(planned: IntentResult, revision: string): string {
    agentRunLifecycle.create({ runId: RUN_ID, request: PROMPT, mode: 'apply', createdRevision: null, createdAt: 1 });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    const group = { groupId: 'group-preview', groupLabel: 'Punchier drums' };
    const actionLabels = planned.actions.map((action) => action.type);
    const compiled = compileAgentActionExecution({
        actions: planned.actions,
        metricGoalState: planned.metricGoalState,
        actionCommandGraph: planned.actionCommandGraph,
        actionLabels,
        group,
        intent: PROMPT,
        projectRevision: revision,
        runId: RUN_ID,
        context: getProjectContext(),
        requiresConfirmation: true,
    });
    if (compiled.agentApproval === null) {
        throw new Error('Expected the batch to wait for approval.');
    }
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
        compiled.commandBatch.serialized,
        compiled.commandBatch.authority
    );
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    const confirmationId = persistPromptActionConfirmation({
        runId: RUN_ID,
        prompt: PROMPT,
        assistantMessageId: ASSISTANT_ID,
        actions: planned.actions,
        actionLabels,
        commandEnvelopes: compiled.commandEnvelopes,
        commandBatch: compiled.commandBatch,
        agentApproval: compiled.agentApproval,
        metricGoalState: compiled.metricGoalState,
        affectedIds: ['drums'],
        protectedUnchanged: [],
        measuredPreview: planned.measuredPreview,
        executionMode: 'atomic',
        group,
        projectRevision: revision,
        parsedCommandBatch,
        content: 'Punchier drums',
    });
    if (confirmationId === null) {
        throw new Error('Expected the proposal to be retained for approval.');
    }
    return confirmationId;
}

function commandIdsOf(confirmationId: string): string[] {
    const commandBatch = getPendingActionConfirmation(confirmationId)?.approvalSnapshot.commandBatch;
    if (commandBatch === undefined) {
        throw new Error('Expected the confirmation to carry a command batch.');
    }
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return parsed.envelope.commands.map((command) => command.commandId);
}

beforeEach(() => {
    configureAiWorkflowCommandPreflightFixture();
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('preview measurement test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
    // A palette that advances on every draw, as the session's does.
    let drawnColors = 0;
    commandTrackDefaultsPort.setTrackColorProvider(() => `#00000${String((drawnColors += 1) % 10)}`);
    clearUndoHistory();
    resetActionReplayAuthority();
    trackStore.set({
        tracks: [
            createTrack({ id: 'master', name: 'Master', kind: 'master' }),
            {
                ...createTrack({ id: 'drums', name: 'Drums', kind: 'audio' }),
                devices: [gainDevice(DRUMS_GAIN_ID), gainDevice(DRUMS_TRIM_ID)],
            },
            { ...createTrack({ id: 'bass', name: 'Bass', kind: 'audio' }), devices: [gainDevice(BASS_GAIN_ID)] },
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    transportStore.set({ ...defaultTransportState, tempo: 120 });
    flushAutomergeStorageWrites();
    clearAgentMeasurementArtifacts();
    engine.renderOffline.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderOfflineInput.mockReset().mockResolvedValue(sineBuffer(0.5));
    engine.renderTrackSubgraphOffline.mockReset().mockImplementation(renderSubgraph);
    engine.updateDeviceParam.mockReset();
    vi.mocked(generateToolPlanningOutcome).mockReset();
    vi.mocked(tryPresetMatch).mockReturnValue([]);
    vi.mocked(tryParameterizedPath).mockReturnValue([]);
    vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    chatStore.set({
        messages: [{ id: ASSISTANT_ID, role: 'assistant', content: 'Planning', timestamp: 1 }],
        isGenerating: false,
        enableReasoning: true,
        chatMode: 'prompt',
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    resetAiWorkflowCommandPreflightFixture();
    commandTrackDefaultsPort.setTrackColorProvider(null);
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    clearAgentMeasurementArtifacts();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    projectStore.set(structuredClone(defaultProjectStoreState));
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('receipt-backed retained audition through the admitted prompt caller', () => {
    it.each(['prompt-bar', 'preset'] as const)(
        'preserves genuine planner proof through %s and refuses missing or foreign receipts',
        async (source) => {
            const revision = captureProjectRevision();
            const history = structuredClone(undoHistoryStore.value);
            scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6)));
            const result = await submitAdmittedPromptRequest({ prompt: PROMPT, source, requiresConfirmation: true });
            expect(result.status).toBe('awaiting-approval');
            if (result.status !== 'awaiting-approval') {
                throw new Error(`Actual prompt admission failed: ${result.status}`);
            }
            const input = { confirmationId: result.confirmationId, targetId: 'drums' };
            const resolved = resolveMeasuredPreviewAudition(input);
            expect(resolved.status).toBe('available');
            if (resolved.status !== 'available') {
                throw new Error(resolved.reason);
            }
            expect(resolved.baseline.buffer).not.toBe(resolved.preview.buffer);
            expect(resolved.baseline.gain).toBeCloseTo(10 ** (-6 / 20), 2);
            expect(resolved.preview.gain).toBe(1);
            expect(getAgentApprovalView({ confirmationId: result.confirmationId })?.canConfirm).toBe(false);
            expect(resolveMeasuredPreviewAudition({ ...input, selectedIntentGroupIds: [] }).status).toBe('unavailable');
            const view = getMeasuredPreviewAuditionView({ confirmationId: result.confirmationId });
            expect(view.targets[0]).toMatchObject({ targetId: 'drums', available: true });
            expect(JSON.stringify(view)).not.toContain('contentAddress');
            expect(JSON.stringify(view)).not.toContain('getChannelData');
            const run = agentRunLifecycle.get(result.runId);
            if (run?.plan === null || run?.plan === undefined) {
                throw new Error('The actual admitted caller must persist a plan.');
            }
            const applicationToolReceipts = run.plan.applicationToolReceipts;
            expect(applicationToolReceipts).toBeDefined();
            if (applicationToolReceipts === undefined) {
                throw new Error('The admitted measurement must persist its application tool receipts.');
            }
            expect(
                applicationToolReceipts.some(
                    (receipt) => receipt.callId === 'measure-1' && receipt.status === 'success'
                )
            ).toBe(true);
            for (const receipts of [
                [],
                applicationToolReceipts.map((receipt) => ({ ...receipt, callId: 'foreign-measurement' })),
            ]) {
                agentRunStore.update((state) => {
                    if (!state) {
                        return state;
                    }
                    return {
                        ...state,
                        runs: state.runs.map((candidate) => {
                            if (candidate.runId === result.runId && candidate.plan !== null) {
                                return { ...candidate, plan: { ...candidate.plan, applicationToolReceipts: receipts } };
                            }
                            return candidate;
                        }),
                    };
                });
                expect(resolveMeasuredPreviewAudition(input).status).toBe('unavailable');
            }
            agentRunStore.update((state) => {
                if (!state) {
                    return state;
                }
                return {
                    ...state,
                    runs: state.runs.map((candidate) => {
                        if (candidate.runId === run.runId) {
                            return run;
                        }
                        return candidate;
                    }),
                };
            });
            expect(resolveMeasuredPreviewAudition(input).status).toBe('available');
            const confirmation = getPendingActionConfirmation(result.confirmationId);
            const goals = metricGoalStateCodec(confirmation?.approvalSnapshot.metricGoalState);
            if (confirmation === null || goals === null) {
                throw new Error('Missing actual bound proof.');
            }
            const forged = {
                ...goals,
                proofs: goals.proofs.map((proof) => ({
                    ...proof,
                    preview: {
                        ...proof.preview,
                        targets: proof.preview.targets.map((target) => {
                            if (target.audition === undefined) {
                                return target;
                            }
                            return {
                                ...target,
                                audition: {
                                    ...target.audition,
                                    baseline: {
                                        ...target.audition.baseline,
                                        artifact: { contentAddress: target.audition.preview.artifact.contentAddress },
                                    },
                                },
                            };
                        }),
                    },
                })),
            };
            pendingActionConfirmationStore.update((state) => {
                if (!state) {
                    return state;
                }
                return {
                    ...state,
                    confirmations: state.confirmations.map((entry) => {
                        if (entry.id === confirmation.id) {
                            return {
                                ...entry,
                                approvalSnapshot: {
                                    ...entry.approvalSnapshot,
                                    metricGoalState: JSON.stringify(forged),
                                },
                            };
                        }
                        return entry;
                    }),
                };
            });
            await expect(startMeasuredPreviewAudition({ ...input, side: 'baseline' })).resolves.toMatchObject({
                status: 'unavailable',
            });
            pendingActionConfirmationStore.update((state) => {
                if (!state) {
                    return state;
                }
                return {
                    ...state,
                    confirmations: state.confirmations.map((entry) => {
                        if (entry.id === confirmation.id) {
                            return confirmation;
                        }
                        return entry;
                    }),
                };
            });
            const expired = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 60 * 1_000);
            try {
                expect(getAgentApprovalView({ confirmationId: result.confirmationId })?.freshness.status).toBe(
                    'current'
                );
                const retainedAddress =
                    goals.proofs.at(-1)?.preview.targets[0]?.audition?.baseline.artifact.contentAddress;
                if (retainedAddress === undefined) {
                    throw new Error('Missing genuine retained baseline address.');
                }
                expect(getAgentMeasurementArtifact(retainedAddress)).toBeNull();
                await expect(startMeasuredPreviewAudition({ ...input, side: 'preview' })).resolves.toMatchObject({
                    status: 'unavailable',
                });
            } finally {
                expired.mockRestore();
            }
            clearAgentMeasurementArtifacts();
            await expect(startMeasuredPreviewAudition({ ...input, side: 'baseline' })).resolves.toMatchObject({
                status: 'unavailable',
            });
            expect(drumsLevel()).toBe(0);
            expect(captureProjectRevision()).toBe(revision);
            expect(undoHistoryStore.value).toEqual(history);
        }
    );
});

describe('analysis.measure of a proposal preview', () => {
    // Red when the preview subject stops rendering the proposal's own document beside the live one.
    it('measures a preview that lowers the drums against the live project and leaves the project untouched', async () => {
        const revision = captureProjectRevision();

        const read = await measure(previewArgs(proposalOf(lowerGain(DRUMS_GAIN_ID, -6))), revision);

        expect(read.receipt.error).toBeNull();
        expect(read.receipt).toMatchObject({ status: 'success', revision, data: { subject: 'preview' } });
        const [target] = read.measuredPreview?.targets ?? [];
        expect(target).toMatchObject({
            targetId: 'drums',
            baseline: { integratedLoudness: { status: 'measured' } },
            preview: { integratedLoudness: { status: 'measured' } },
            deltas: { integratedLoudness: { status: 'compared' } },
        });
        const delta = target?.deltas.integratedLoudness;
        expect(delta?.status === 'compared' ? delta.delta : Number.NaN).toBeCloseTo(-6, 1);
        expect(read.commands?.map((command) => command.operation)).toEqual(['setDeviceParameter']);
        expect(captureProjectRevision()).toBe(revision);
        expect(drumsLevel()).toBe(0);
        expect(engine.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('retains the exact differing render pair and private match figures without widening requested metrics', async () => {
        const revision = captureProjectRevision();
        const history = structuredClone(undoHistoryStore.value);
        const baseline = sineBuffer(0.5, 48_000, 2, 2);
        const proposed = sineBuffer(0.25, 44_100, 1.5, 1);
        const baselinePcm = baseline.getChannelData(0).slice();
        const proposedPcm = proposed.getChannelData(0).slice();
        engine.renderTrackSubgraphOffline.mockReset().mockResolvedValueOnce(baseline).mockResolvedValueOnce(proposed);
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6)), ['rms']);
        const { planned, confirmationId } = await approvalMeasuredPreview(revision);
        const saved = getPendingActionConfirmation(confirmationId)?.approvalSnapshot.measuredPreview;
        const pair = saved?.targets[0]?.audition;
        if (pair === undefined) {
            throw new Error('The actual admitted preview must carry its retained audition pair.');
        }
        expect(pair).toMatchObject({
            baseline: {
                route: 'isolated-subgraph',
                sampleRate: 48_000,
                frameCount: 96_000,
                channelCount: 2,
                durationSeconds: 2,
            },
            preview: {
                route: 'isolated-subgraph',
                sampleRate: 44_100,
                frameCount: 66_150,
                channelCount: 1,
                durationSeconds: 1.5,
            },
            baselineIntegratedLoudness: { status: 'measured', unit: 'LUFS' },
            previewIntegratedLoudness: { status: 'measured', unit: 'LUFS' },
        });
        expect(getAgentMeasurementArtifact(pair.baseline.artifact.contentAddress)?.buffer).toBe(baseline);
        expect(getAgentMeasurementArtifact(pair.preview.artifact.contentAddress)?.buffer).toBe(proposed);
        expect(saved?.provenance).toMatchObject({ origin: 'planner', callId: 'measure-1', runId: expect.any(String) });
        expect(Object.keys(saved?.targets[0]?.baseline ?? {})).toEqual(['rms']);
        expect(Object.keys(saved?.targets[0]?.preview ?? {})).toEqual(['rms']);
        expect(Object.keys(saved?.targets[0]?.deltas ?? {})).toEqual(['rms']);
        const receipt = planned.applicationToolReceipts?.find(({ callId }) => callId === 'measure-1');
        expect(receipt?.data).toMatchObject({
            metrics: ['rms'],
            targets: [
                { baselineRender: { route: 'isolated-subgraph' }, previewRender: { route: 'isolated-subgraph' } },
            ],
        });
        expect(JSON.stringify(receipt)).not.toContain('audition');
        expect(JSON.stringify(receipt)).not.toContain('baselineIntegratedLoudness');
        expect(JSON.stringify(receipt)).not.toContain('AudioBuffer');
        expect(baseline.getChannelData(0)).toEqual(baselinePcm);
        expect(proposed.getChannelData(0)).toEqual(proposedPcm);
        expect(captureProjectRevision()).toBe(revision);
        expect(undoHistoryStore.value).toEqual(history);
        expect(drumsLevel()).toBe(0);
        expect(engine.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('keeps requested measurement success when auxiliary loudness is unavailable', async () => {
        const measureObjective = audioAnalysisUseCases.measureAgentScopeRender;
        const spy = vi.spyOn(audioAnalysisUseCases, 'measureAgentScopeRender').mockImplementation((buffer, metrics) => {
            const figures = measureObjective(buffer, metrics);
            delete figures.integratedLoudness;
            return figures;
        });
        try {
            const read = await measure(previewArgs(proposalOf(lowerGain(DRUMS_GAIN_ID, -6)), ['rms']));
            expect(read.receipt).toMatchObject({ status: 'success', data: { metrics: ['rms'] }, error: null });
            expect(read.measuredPreview?.targets[0]).toMatchObject({
                baseline: { rms: { status: 'measured' } },
                preview: { rms: { status: 'measured' } },
                audition: {
                    baselineIntegratedLoudness: { status: 'unavailable' },
                    previewIntegratedLoudness: { status: 'unavailable' },
                },
            });
        } finally {
            spy.mockRestore();
        }
    });

    // Red when the loop stops comparing a retained preview's revision with the measurement's own.
    it('refuses a proposal adopting a preview measured at another revision', async () => {
        const result = await measureThenAdopt(proposalOf(lowerGain(DRUMS_GAIN_ID, -6)), 'revision-moved-on');

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('stale transform compilation or recipe expansion, or measured preview');
        }
    });

    // Red when a proposal list that fails grounding is still previewed, measured or retained.
    it('returns a typed failure for a proposal list that fails grounding and retains nothing', async () => {
        // Below the gain device's −60 dB floor: the list compiles, and the bridge refuses the value.
        const result = await measureThenAdopt(proposalOf(lowerGain(DRUMS_GAIN_ID, -80)), captureProjectRevision());

        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
            expect(result.reason).toContain('unknown, duplicate, or failed');
            expect(result.receipts[0]).toMatchObject({
                status: 'failure',
                error: {
                    code: 'preview-proposal-rejected',
                    safeMessage: expect.stringContaining('The proposal list failed grounding'),
                },
            });
        }
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    // Red when the default subject stops returning the project receipt it always has.
    // Red when compiling or previewing a track the batch creates draws from the session palette.
    it('leaves the session palette where it was after measuring a preview that creates a track', async () => {
        commandTrackDefaultsPort.setTrackColorProvider(reserveNextTrackColorForCommand);
        // Learn the palette's order from the real palette: each color's successor.
        const draws = Array.from({ length: 30 }, () => reserveNextTrackColorForCommand());
        const successor = new Map(draws.slice(1).map((color, index) => [draws[index], color]));
        const before = reserveNextTrackColorForCommand();
        const addRoom = { id: 'add-room', name: 'addTrack', arguments: { name: 'Drum Room', kind: 'audio' } };

        const read = await measure(previewArgs({ schemaVersion: 1, items: [addRoom] }));

        expect(read.receipt.error).toBeNull();
        expect(reserveNextTrackColorForCommand()).toBe(successor.get(before));
    });

    it('measures the project unchanged when no subject is named', async () => {
        const revision = captureProjectRevision();

        const read = await measure({ scope: DRUMS_SCOPE, range: RANGE, metrics: ['integratedLoudness'] }, revision);

        expect(read).toMatchObject({ commands: null, measuredPreview: null });
        expect(read.receipt).toMatchObject({ status: 'success', revision });
        expect(read.receipt.data).not.toHaveProperty('subject');
        expect(read.receipt.data).toMatchObject({
            kind: 'analysis-measurement',
            targets: [{ targetId: 'drums', measurements: { integratedLoudness: { status: 'measured' } } }],
        });
        expect(engine.renderTrackSubgraphOffline).toHaveBeenCalledOnce();
    });
});

describe('a measured preview through proposal and approval', () => {
    // Red when an adopted preview stops carrying its measured commands into the batch, or its
    // figures stop reaching the approval view.
    it('adopts the preview by call id as exactly the measured batch and shows its deltas for approval', async () => {
        const revision = captureProjectRevision();
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6)));

        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });

        expect(planned.rejectionReason).toBeUndefined();
        const measured = planned.applicationToolReceipts?.find((receipt) => receipt.callId === 'measure-1');
        expect(measured?.status).toBe('success');
        const data: unknown = measured?.data;
        const measuredCommands = typeof data === 'object' && data !== null && 'commands' in data ? data.commands : null;
        expect(planned.actions).toHaveLength(1);
        expect(planned.actions).toMatchObject([
            { type: 'setDeviceParameter', payload: { deviceId: DRUMS_GAIN_ID, paramId: 'gain-level', value: -6 } },
        ]);
        expect(measuredCommands).toEqual([
            { name: 'setDeviceParameter', arguments: { deviceId: DRUMS_GAIN_ID, paramId: 'gain-level', value: -6 } },
        ]);

        const confirmationId = persistForApproval(planned, revision);
        const [target] = getAgentApprovalView({ confirmationId })?.measuredPreview?.targets ?? [];
        const loudness = target?.metrics.find((metric) => metric.metricId === 'integratedLoudness');
        expect(target?.targetId).toBe('drums');
        expect(loudness?.baseline).toMatchObject({ unit: 'LUFS' });
        expect(loudness?.preview).toMatchObject({ unit: 'LUFS' });
        expect(loudness?.delta?.value).toBeCloseTo(-6, 1);
        expect(drumsLevel()).toBe(0);
    });

    // Red when the order the planning prompt states (resolve, measure, discover and expand a recipe, measure
    // the planned list as a preview, then propose adopting only the preview by call id) stops completing
    // with measured deltas.
    it('completes the prompt-stated method: resolve, measure, recipe, preview measure, then a propose adopting the preview', async () => {
        const revision = captureProjectRevision();
        const historyBefore = structuredClone(undoHistoryStore.value);
        const recipeValues = [
            { paramId: 'comp-threshold', value: -18 },
            { paramId: 'comp-ratio', value: 4 },
            { paramId: 'comp-attack', value: 30 },
            { paramId: 'comp-release', value: 100 },
            { paramId: 'comp-makeup', value: 4.5 },
        ];
        const ADOPTED_CALL_IDS = ['measure-preview'];
        scriptTurns(revision, [
            // The target is resolved from the project context, so no project.query turn is spent. The
            // measure and the discovery need no earlier receipt and share a turn: four tool turns, after
            // the interpretation turn above.
            [
                {
                    id: 'measure-target',
                    name: 'analysis.measure',
                    arguments: {
                        scope: DRUMS_SCOPE,
                        range: RANGE,
                        metrics: ['integratedLoudness'],
                        subject: 'project',
                    },
                },
                {
                    id: 'discover-1',
                    name: 'recipe.discover',
                    arguments: { descriptors: ['punchy'], targetId: 'drums' },
                },
            ],
            [
                {
                    id: 'expand-1',
                    name: 'recipe.expand',
                    arguments: {
                        recipeId: 'drums-punchy',
                        targetId: 'drums',
                        values: recipeValues.map((value) => ({ step: 0, ...value })),
                    },
                },
            ],
            [
                {
                    id: 'measure-preview',
                    name: 'analysis.measure',
                    arguments: {
                        scope: DRUMS_SCOPE,
                        range: RANGE,
                        metrics: ['integratedLoudness'],
                        subject: 'preview',
                        recipeCallId: 'expand-1',
                    },
                },
            ],
            [proposeCall({ commands: [], compiledCallIds: ADOPTED_CALL_IDS })],
        ]);

        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });

        const receipts = planned.applicationToolReceipts ?? [];
        const failedReads = receipts.flatMap((receipt) => (receipt.error === null ? [] : [receipt.error.safeMessage]));
        expect({ rejection: planned.rejectionReason ?? null, failedReads }).toEqual({
            rejection: null,
            failedReads: [],
        });
        expect(vi.mocked(generateToolPlanningOutcome)).toHaveBeenCalledTimes(5);
        const replay: HostedTurnHistory | undefined = vi
            .mocked(generateToolPlanningOutcome)
            .mock.calls.at(-1)?.[9]?.history;
        expect(replay?.flatMap((turn) => turn.receipts).map((receipt) => receipt.callId)).toEqual(
            receipts.map((receipt) => receipt.callId)
        );
        const turnOf = (callId: string) => receipts.find((receipt) => receipt.callId === callId)?.turn;
        expect(turnOf('discover-1')).toBe(turnOf('measure-target'));
        expect(turnOf('expand-1')).toBeGreaterThan(turnOf('discover-1') ?? Number.POSITIVE_INFINITY);
        expect(turnOf('measure-preview')).toBeGreaterThan(turnOf('expand-1') ?? Number.POSITIVE_INFINITY);
        expect(receipts.map(({ callId, status }) => ({ callId, status }))).toEqual(
            expect.arrayContaining(
                ['measure-target', 'discover-1', 'expand-1', 'measure-preview'].map((callId) => ({
                    callId,
                    status: 'success',
                }))
            )
        );
        const expansion: unknown = receipts.find(({ callId }) => callId === 'expand-1')?.data;
        const expandedValues =
            typeof expansion === 'object' && expansion !== null && 'values' in expansion ? expansion.values : null;
        expect(expandedValues).toMatchObject(recipeValues);
        expect(planned.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'drums', deviceType: 'builtin-compressor' } },
            ...recipeValues.map(({ paramId, value }) => ({
                type: 'setDeviceParameter',
                payload: { paramId, value },
            })),
        ]);

        const confirmationId = persistForApproval(planned, revision);
        const view = getAgentApprovalView({ confirmationId });
        expect(view?.recipes).toMatchObject([
            { recipeId: 'drums-punchy', targetId: 'drums', title: expect.any(String) },
        ]);
        expect(view?.recipes).toHaveLength(1);
        expect(planned.adoptedRecipes ?? []).toEqual([]);
        expect(planned.actions).toHaveLength(6);
        const [target] = view?.measuredPreview?.targets ?? [];
        const loudness = target?.metrics.find((metric) => metric.metricId === 'integratedLoudness');
        expect(target?.targetId).toBe('drums');
        expect(typeof loudness?.delta?.value).toBe('number');
        expect(captureProjectRevision()).toBe(revision);
        expect(undoHistoryStore.value).toEqual(historyBefore);
        expect(engine.updateDeviceParam).not.toHaveBeenCalled();
    });

    // Red when the query branch the planning prompt states (the context cannot resolve the target: the
    // interpretation, project.query alone, discovery, expansion, then a propose adopting the expansion)
    // stops fitting the loop's turns or completing without a rejection.
    it('completes the prompt-stated query branch in the loop turns: query alone, discover, expand, then adopt the expansion', async () => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        });
        // The identity is persisted through the CRDT, so the revision is captured only once that write has landed.
        flushAutomergeStorageWrites();
        const revision = captureProjectRevision();
        const recipeValues = [
            { paramId: 'comp-threshold', value: -16 },
            { paramId: 'comp-ratio', value: 4 },
            { paramId: 'comp-attack', value: 25 },
            { paramId: 'comp-release', value: 90 },
            { paramId: 'comp-makeup', value: 4.5 },
        ];
        scriptTurns(revision, [
            [{ id: 'resolve-target', name: 'project.query', arguments: { type: 'project-summary' } }],
            [
                {
                    id: 'discover-1',
                    name: 'recipe.discover',
                    arguments: { descriptors: ['punchy'], targetId: 'drums' },
                },
            ],
            [{ id: 'expand-1', name: 'recipe.expand', arguments: { recipeId: 'drums-punchy', targetId: 'drums' } }],
            [proposeCall({ commands: [], compiledCallIds: ['expand-1'] })],
        ]);

        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });

        const receipts = planned.applicationToolReceipts ?? [];
        const failedReads = receipts.flatMap((receipt) => (receipt.error === null ? [] : [receipt.error.safeMessage]));
        expect({ rejection: planned.rejectionReason ?? null, failedReads }).toEqual({
            rejection: null,
            failedReads: [],
        });
        // The interpretation turn, then query, discover, expand and the propose: five turns, the loop's
        // four plus the one an admitted interpretation adds.
        expect(vi.mocked(generateToolPlanningOutcome)).toHaveBeenCalledTimes(5);
        expect(receipts.map(({ callId, status }) => ({ callId, status }))).toEqual(
            expect.arrayContaining(
                ['resolve-target', 'discover-1', 'expand-1'].map((callId) => ({ callId, status: 'success' }))
            )
        );
        expect(planned.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'drums', deviceType: 'builtin-compressor' } },
            ...recipeValues.map(({ paramId, value }) => ({ type: 'setDeviceParameter', payload: { paramId, value } })),
        ]);
        expect(planned.measuredPreview).toBeUndefined();
    });

    // Red when the batch hash counts the ids each compilation mints for the objects it creates.
    it('shows the figures for a preview that creates a device, though the adopting batch mints new ids', async () => {
        const revision = captureProjectRevision();
        const addGain = {
            id: 'add-gain',
            name: 'addDevice',
            arguments: { deviceType: 'builtin-gain', binding: 'gain' },
            selector: {
                targetArgument: 'trackId',
                entity: 'track',
                where: { name: 'Drums' },
                quantity: { unit: 'targets', exactly: 1 },
            },
        };
        const setGain = {
            id: 'set-gain',
            name: 'setDeviceParameter',
            arguments: { deviceId: '$gain', paramId: 'gain-level', value: -6 },
            dependsOn: ['add-gain'],
        };
        scriptMeasureThenAdoptTurns(revision, { schemaVersion: 1, items: [addGain, setGain] });

        const { planned, measuredPreview } = await approvalMeasuredPreview(revision);

        expect(planned.actions).toMatchObject([
            { type: 'addDevice', payload: { trackId: 'drums' } },
            { type: 'setDeviceParameter', payload: { paramId: 'gain-level', value: -6 } },
        ]);
        expect(measuredPreview?.targets.map(({ targetId }) => targetId)).toEqual(['drums']);
    });

    // Red when the batch hash counts the ids the application assigns an object nothing binds.
    it('shows the figures for a preview that creates an unbound track, whose ids each compilation assigns', async () => {
        const revision = captureProjectRevision();
        const addRoom = { id: 'add-room', name: 'addTrack', arguments: { name: 'Drum Room', kind: 'audio' } };
        scriptMeasureThenAdoptTurns(revision, { schemaVersion: 1, items: [addRoom] });

        const { planned, measuredPreview } = await approvalMeasuredPreview(revision);

        expect(planned.actions).toMatchObject([{ type: 'addTrack', payload: { name: 'Drum Room' } }]);
        expect(measuredPreview?.targets.map(({ targetId }) => targetId)).toEqual(['drums']);
    });

    // Each row below is red when the figures are attached without comparing the persisted batch's
    // content hash with the hash of the batch the preview rendered.
    it('shows no figures when the turn adds a workflow call beside the adopted preview', async () => {
        const revision = captureProjectRevision();
        scriptTurns(revision, [
            [measureCallFor('measure-1', proposalOf(lowerGain(DRUMS_GAIN_ID, -6)))],
            [
                proposeCall({ commands: [], compiledCallIds: ['measure-1'] }),
                { id: 'trim-1', name: 'setDeviceParameter', arguments: TRIM_EDIT },
            ],
        ]);

        const { planned, measuredPreview } = await approvalMeasuredPreview(revision);

        expect(planned.actions).toHaveLength(2);
        expect(measuredPreview).toBeNull();
    });

    it('shows no figures when the proposal adopts a second compilation beside the preview', async () => {
        const revision = captureProjectRevision();
        scriptTurns(revision, [
            [measureCallFor('measure-1', proposalOf(lowerGain(DRUMS_GAIN_ID, -6)))],
            [measureCallFor('measure-2', proposalOf(lowerGain(DRUMS_TRIM_ID, -12)))],
            [proposeCall({ commands: [], compiledCallIds: ['measure-1', 'measure-2'] })],
        ]);

        const { planned, measuredPreview } = await approvalMeasuredPreview(revision);

        expect(planned.actions).toHaveLength(2);
        expect(measuredPreview).toBeNull();
    });

    it('shows no figures when the proposal carries a command of its own beside the preview', async () => {
        const revision = captureProjectRevision();
        scriptTurns(revision, [
            [
                measureCallFor('measure-1', proposalOf(lowerGain(DRUMS_GAIN_ID, -6))),
                {
                    id: 'discover-1',
                    name: 'agent.catalog.discover',
                    arguments: { category: 'command', names: ['setDeviceParameter'] },
                },
            ],
            [
                proposeCall({
                    commands: [{ name: 'setDeviceParameter', arguments: TRIM_EDIT }],
                    compiledCallIds: ['measure-1'],
                }),
            ],
        ]);

        const { planned, measuredPreview } = await approvalMeasuredPreview(revision);

        expect(planned.actions).toHaveLength(2);
        expect(measuredPreview).toBeNull();
    });

    // Red when the persisted figures stop matching the batch they were measured on, so a
    // re-proposal that rebuilds the very same batch loses them.
    it('keeps the measured preview on a re-proposal of the identical batch', async () => {
        const revision = captureProjectRevision();
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6), lowerGain(DRUMS_TRIM_ID, -3)));
        const { confirmationId, measuredPreview } = await approvalMeasuredPreview(revision);
        expect(measuredPreview).not.toBeNull();

        const reproposed = await reproposePendingChatActions({ confirmationId });

        expect(reproposed.status).toBe('reproposed');
        if (reproposed.status === 'reproposed') {
            expect(reproposed.confirmationId).not.toBe(confirmationId);
            expect(commandIdsOf(reproposed.confirmationId)).toHaveLength(2);
            const [target] =
                getAgentApprovalView({ confirmationId: reproposed.confirmationId })?.measuredPreview?.targets ?? [];
            const loudness = target?.metrics.find((metric) => metric.metricId === 'integratedLoudness');
            expect(loudness?.delta?.value).toBeCloseTo(-9, 1);
        }
    });

    // Red when a re-proposal anchored to a later revision keeps figures rendered from the older mix.
    it('drops the measured preview when a re-proposal rebinds the identical batch to a project that moved', async () => {
        const revision = captureProjectRevision();
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6)));
        const { confirmationId, measuredPreview } = await approvalMeasuredPreview(revision);
        expect(measuredPreview).not.toBeNull();
        trackStore.set({
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === 'bass' ? { ...track, gain: 0.5 } : track
            ),
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        expect(captureProjectRevision()).not.toBe(revision);

        const reproposed = await reproposePendingChatActions({ confirmationId });

        expect(reproposed.status).toBe('reproposed');
        if (reproposed.status === 'reproposed') {
            expect(commandIdsOf(reproposed.confirmationId)).toHaveLength(1);
            expect(
                getPendingActionConfirmation(reproposed.confirmationId)?.approvalSnapshot.measuredPreview
            ).toBeUndefined();
        }
    });

    // Red when a re-proposal keeps figures for a batch it has cut down.
    it('drops the measured preview from a subset re-proposal', async () => {
        const revision = captureProjectRevision();
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6), lowerGain(DRUMS_TRIM_ID, -3)));
        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });
        expect(planned.rejectionReason).toBeUndefined();
        const confirmationId = persistForApproval(planned, revision);
        expect(getPendingActionConfirmation(confirmationId)?.approvalSnapshot.measuredPreview).toBeDefined();
        const [drumsCommandId] = commandIdsOf(confirmationId);

        const reproposed = await reproposePendingChatActions({
            confirmationId,
            selectedIntentGroupIds: drumsCommandId === undefined ? [] : [drumsCommandId],
        });

        expect(reproposed.status).toBe('reproposed');
        if (reproposed.status === 'reproposed') {
            expect(commandIdsOf(reproposed.confirmationId)).toHaveLength(1);
            expect(
                getPendingActionConfirmation(reproposed.confirmationId)?.approvalSnapshot.measuredPreview
            ).toBeUndefined();
            expect(getAgentApprovalView({ confirmationId: reproposed.confirmationId })?.measuredPreview).toBeNull();
        }
    });
});

describe('recipe preview evidence stays with the exact measured batch', () => {
    it('keeps both recipe identity and figures on unchanged whole reproposal', async () => {
        const revision = captureProjectRevision();
        scriptRecipePreview(revision);
        const { confirmationId } = await approvalMeasuredPreview(revision);
        const original = getAgentApprovalView({ confirmationId });
        expect(original?.recipes).toHaveLength(1);
        expect(original?.measuredPreview).not.toBeNull();
        const result = await reproposePendingChatActions({ confirmationId });
        expect(result.status).toBe('reproposed');
        if (result.status !== 'reproposed') {
            throw new Error('Expected reproposal');
        }
        const view = getAgentApprovalView({ confirmationId: result.confirmationId });
        expect(view?.recipes).toEqual(original?.recipes);
        expect(view?.measuredPreview).toEqual(original?.measuredPreview);
        expect(getPendingActionConfirmation(result.confirmationId)?.approvalSnapshot.adoptedRecipes ?? []).toEqual([]);
    });

    it('drops both recipe identity and figures from an augmented terminal batch', async () => {
        const revision = captureProjectRevision();
        scriptRecipePreview(revision, [{ name: 'setDeviceParameter', arguments: TRIM_EDIT }]);
        const { confirmationId } = await approvalMeasuredPreview(revision);
        expect(getAgentApprovalView({ confirmationId })).toMatchObject({ recipes: [], measuredPreview: null });
    });

    it('drops identity and figures when one measured value changes before persistence', async () => {
        const revision = captureProjectRevision();
        scriptRecipePreview(revision);
        const planned = await parsePromptToActions({
            prompt: PROMPT,
            context: getProjectContext(),
            projectRevision: revision,
        });
        expect(planned.rejectionReason).toBeUndefined();
        expect(planned.measuredPreview?.recipeSource).toBeDefined();
        const actions = planned.actions.map((action) => {
            if (action.type === 'setDeviceParameter' && action.payload.paramId === 'comp-threshold') {
                return { ...action, payload: { ...action.payload, value: -20 } };
            }
            return action;
        });
        const confirmationId = persistForApproval({ ...planned, actions }, revision);
        expect(getAgentApprovalView({ confirmationId })).toMatchObject({ recipes: [], measuredPreview: null });
    });

    it.each(['budget', 'duplicate-reference'] as const)(
        'refuses adoption after %s without granting preview provenance',
        async (mode) => {
            const revision = captureProjectRevision();
            const preview = previewDependencies(revision);
            const expansion = executeRecipeExpansion({
                call: recipeExpansionCall(),
                callId: 'expand-1',
                turn: 1,
                ordinal: 1,
                context: preview.context,
                revision,
            });
            const expansionBytes = new TextEncoder().encode(JSON.stringify(expansion.receipt)).length;
            const ids = mode === 'duplicate-reference' ? ['measure-recipe', 'measure-recipe'] : ['measure-recipe'];
            const turns = [
                [recipeExpansionCall()],
                [recipePreviewCall()],
                [proposeCall({ commands: [], compiledCallIds: ids })],
            ];
            const requestTurn = vi.fn();
            for (const toolCalls of turns) {
                requestTurn.mockResolvedValueOnce({ status: 'complete', toolCalls });
            }
            const measured: AnalysisMeasureRead[] = [];
            const loopInput: Parameters<typeof runApplicationOwnedToolLoop>[0] = {
                loopId: 'recipe-preview-admission',
                terminalToolNames: new Set(['command.batch.propose']),
                requestTurn,
                recipe: {
                    toolName: 'recipe.expand',
                    revision,
                    execute: (call, ids) =>
                        executeRecipeExpansion({ call, ...ids, context: preview.context, revision }),
                },
                measurement: {
                    toolName: 'analysis.measure',
                    revision,
                    execute: async (call, ids) => {
                        const read = await executeAnalysisMeasure({
                            call,
                            ...ids,
                            projectRevision: revision,
                            sections: [],
                            preview: { ...preview, retainedCompilations: ids.retainedCompilations },
                        });
                        measured.push(read);
                        return read;
                    },
                },
            };
            if (mode === 'budget') {
                loopInput.limits = { maxReceiptBytesPerCall: expansionBytes };
            }
            const result = await runApplicationOwnedToolLoop(loopInput);
            expect(measured[0]?.receipt.status).toBe('success');
            expect(measured[0]?.measuredPreview?.recipeSource).toBeDefined();
            expect(result).toMatchObject({
                status: 'rejected',
                reason: expect.stringContaining('unknown, duplicate, or failed'),
            });
            if (mode === 'budget') {
                expect(new TextEncoder().encode(JSON.stringify(measured[0]?.receipt)).length).toBeGreaterThan(
                    expansionBytes
                );
                expect(result.receipts.find((receipt) => receipt.callId === 'expand-1')?.status).toBe('success');
                expect(result.receipts.find((receipt) => receipt.callId === 'measure-recipe')?.status).toBe('failure');
            }
        }
    );

    it('drops both recipe identity and figures when the revision moves', async () => {
        const revision = captureProjectRevision();
        scriptRecipePreview(revision);
        const { confirmationId } = await approvalMeasuredPreview(revision);
        trackStore.set({
            ...trackStore.value!,
            tracks: (trackStore.value?.tracks ?? []).map((track) =>
                track.id === 'bass' ? { ...track, gain: 0.5 } : track
            ),
        });
        flushAutomergeStorageWrites();
        const result = await reproposePendingChatActions({ confirmationId });
        expect(result.status).toBe('reproposed');
        if (result.status !== 'reproposed') {
            throw new Error('Expected reproposal');
        }
        expect(getAgentApprovalView({ confirmationId: result.confirmationId })).toMatchObject({
            recipes: [],
            measuredPreview: null,
        });
    });

    it('drops identity and figures for a subset even if its digest equals the whole batch', async () => {
        vi.spyOn(batchDigest, 'digestCommandBatchContent').mockReturnValue('same-content-digest');
        const revision = captureProjectRevision();
        scriptRecipePreview(revision);
        const { confirmationId } = await approvalMeasuredPreview(revision);
        expect(getAgentApprovalView({ confirmationId })?.recipes).toHaveLength(1);
        const [deviceCommandId] = commandIdsOf(confirmationId);
        if (deviceCommandId === undefined) {
            throw new Error('Expected device command');
        }
        const result = await reproposePendingChatActions({ confirmationId, selectedIntentGroupIds: [deviceCommandId] });
        expect(result.status).toBe('reproposed');
        if (result.status !== 'reproposed') {
            throw new Error('Expected subset reproposal');
        }
        expect(getAgentApprovalView({ confirmationId: result.confirmationId })).toMatchObject({
            recipes: [],
            measuredPreview: null,
        });
    });

    it('remeasures an admitted earlier recipe in a later turn without expanding it again', async () => {
        const revision = captureProjectRevision();
        const preview = previewDependencies(revision);
        const turns = [
            [recipeExpansionCall()],
            [recipePreviewCall('measure-first')],
            [recipePreviewCall('measure-second')],
            [proposeCall({ commands: [], compiledCallIds: ['measure-second'] })],
        ];
        const requestTurn = vi.fn();
        for (const toolCalls of turns) {
            requestTurn.mockResolvedValueOnce({ status: 'complete', toolCalls });
        }
        const executeExpansion = vi.fn((call: ToolCallResult, ids: { callId: string; turn: number; ordinal: number }) =>
            executeRecipeExpansion({ call, ...ids, context: preview.context, revision })
        );
        const result = await runApplicationOwnedToolLoop({
            loopId: 'repeat-recipe',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
            recipe: { toolName: 'recipe.expand', revision, execute: executeExpansion },
            measurement: {
                toolName: 'analysis.measure',
                revision,
                execute: (call, ids) =>
                    executeAnalysisMeasure({
                        call,
                        ...ids,
                        projectRevision: revision,
                        sections: [],
                        preview: { ...preview, retainedCompilations: ids.retainedCompilations },
                    }),
            },
        });
        expect(result.status).toBe('complete');
        expect(executeExpansion).toHaveBeenCalledTimes(1);
        expect(
            result.receipts
                .filter((receipt) => receipt.toolName === 'analysis.measure')
                .map((receipt) => receipt.status)
        ).toEqual(['success', 'success']);
    });
});

describe('recipe previews retain existing render controls', () => {
    it('releases a refused budget preview so the next measurement can run', async () => {
        const refused = await measureRecipe({ admit: () => ({ status: 'refused', category: 'maxRenderJobs' }) });
        expect(refused).toMatchObject({
            commands: null,
            measuredPreview: null,
            receipt: { status: 'failure', error: { code: 'measurement-budget-exhausted' } },
        });
        expect(engine.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        expect((await measureRecipe()).receipt.status).toBe('success');
    });

    it('settles cancellation, retains no preview identity, and releases the isolated workspace', async () => {
        const controller = new AbortController();
        const settle = vi.fn();
        engine.renderTrackSubgraphOffline.mockImplementationOnce(async (request: SubgraphRequest) => {
            controller.abort();
            return renderSubgraph(request);
        });
        const read = await measureRecipe({ signal: controller.signal, admit: () => ({ status: 'admitted', settle }) });
        expect(read).toMatchObject({
            commands: null,
            measuredPreview: null,
            receipt: { status: 'failure', error: { code: 'cancelled' } },
        });
        expect(settle).toHaveBeenCalledTimes(1);
        expect((await measureRecipe()).receipt.status).toBe('success');
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type AnalysisMeasureRead } from '../../models/AnalysisMeasureRead';
import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';
import { type IntentResult } from '../../models/IntentResult';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { type ToolCallResult } from '../../transformers/toolCallParser';
import { admitCreativeInterpretation } from '../admitCreativeInterpretation';
import { persistPromptActionConfirmation } from '../agentRequestOrchestration/persistPromptActionConfirmation';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { executeAnalysisMeasure } from '../executeAnalysisMeasure';
import { getAgentApprovalView } from '../getAgentApprovalView';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';
import { prepareCreativeInterpretationCatalog } from '../prepareCreativeInterpretationCatalog';
import { reproposePendingChatActions } from '../reproposePendingChatActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

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

function proposalOf(...items: ReturnType<typeof lowerGain>[]) {
    return { schemaVersion: 1, items };
}

/** Two seconds of a 1 kHz stereo sine at `amplitude`. */
function sineBuffer(amplitude: number): AudioBuffer {
    const length = SAMPLE_RATE * 2;
    const channel = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
        channel[frame] = amplitude * Math.sin((2 * Math.PI * 1_000 * frame) / SAMPLE_RATE);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 2,
        duration: length / SAMPLE_RATE,
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
    if (drums === undefined || processing === undefined) {
        throw new Error('Expected the creative catalog to offer the drums track and its processing.');
    }
    return {
        id: 'interpretation-1',
        name: 'selectCreativeInterpretation',
        arguments: {
            catalogId: catalog.catalogId,
            modeId: 'edit',
            targetCandidateIds: [drums.candidateId],
            editDimensionCandidateIds: [processing.candidateId],
            constraintCandidateIds: [],
            creationSlotIds: [],
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

function previewArgs(proposal: ReturnType<typeof proposalOf>) {
    return { scope: DRUMS_SCOPE, range: RANGE, metrics: ['integratedLoudness'], subject: 'preview', proposal };
}

/** One planning loop: a preview measurement, then a proposal adopting it by call id. */
function measureThenAdopt(proposal: ReturnType<typeof proposalOf>, loopRevision: string) {
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
function scriptMeasureThenAdoptTurns(revision: string, proposal: ReturnType<typeof proposalOf>): void {
    vi.mocked(generateToolPlanningOutcome)
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall(revision)] })
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [{ id: 'measure-1', name: 'analysis.measure', arguments: previewArgs(proposal) }],
        })
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [
                {
                    id: 'propose-1',
                    name: 'command.batch.propose',
                    arguments: { commands: [], compiledCallIds: ['measure-1'] },
                },
            ],
        });
}

/** Persist a planned result for approval as the prompt route does, under a run that is planning. */
function persistForApproval(planned: IntentResult, revision: string): string {
    agentRunLifecycle.create({ runId: RUN_ID, request: PROMPT, mode: 'apply', createdRevision: null, createdAt: 1 });
    agentRunLifecycle.transitionPhase({ runId: RUN_ID, phase: 'planning' });
    const group = { groupId: 'group-preview', groupLabel: 'Punchier drums' };
    const actionLabels = planned.actions.map((action) => action.type);
    const compiled = compileAgentActionExecution({
        actions: planned.actions,
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
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    resetAiWorkflowCommandPreflightFixture();
    clearHandlerRegistry();
    clearUndoHistory();
    resetActionReplayAuthority();
    clearAgentMeasurementArtifacts();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
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

        const planned = await parsePromptToActions(PROMPT, getProjectContext(), undefined, revision);

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

    // Red when a re-proposal keeps figures for a batch it has cut down.
    it('drops the measured preview from a subset re-proposal', async () => {
        const revision = captureProjectRevision();
        scriptMeasureThenAdoptTurns(revision, proposalOf(lowerGain(DRUMS_GAIN_ID, -6), lowerGain(DRUMS_TRIM_ID, -3)));
        const planned = await parsePromptToActions(PROMPT, getProjectContext(), undefined, revision);
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

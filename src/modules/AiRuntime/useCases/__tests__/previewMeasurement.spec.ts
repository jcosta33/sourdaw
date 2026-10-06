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
import { clearAgentMeasurementArtifacts } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
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

/** A semantic command list as `analysis.measure` takes it for a preview. */
type Proposal = { schemaVersion: number; items: readonly Readonly<Record<string, unknown>>[] };

function proposalOf(...items: ReturnType<typeof lowerGain>[]): Proposal {
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

function previewArgs(proposal: Proposal) {
    return { scope: DRUMS_SCOPE, range: RANGE, metrics: ['integratedLoudness'], subject: 'preview', proposal };
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
function scriptMeasureThenAdoptTurns(revision: string, proposal: Proposal): void {
    scriptTurns(revision, [
        [measureCallFor('measure-1', proposal)],
        [proposeCall({ commands: [], compiledCallIds: ['measure-1'] })],
    ]);
}

/** The interpretation turn, then each scripted turn in order. */
function scriptTurns(revision: string, turns: ReadonlyArray<ToolCallResult[]>): void {
    const planning = vi.mocked(generateToolPlanningOutcome);
    planning.mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall(revision)] });
    for (const toolCalls of turns) {
        planning.mockResolvedValueOnce({ status: 'complete', toolCalls });
    }
}

function measureCallFor(id: string, proposal: Proposal): ToolCallResult {
    return { id, name: 'analysis.measure', arguments: previewArgs(proposal) };
}

function proposeCall(args: Record<string, unknown>): ToolCallResult {
    return { id: 'propose-1', name: 'command.batch.propose', arguments: args };
}

/** The drums-trim edit a turn adds beside the measured preview. */
const TRIM_EDIT = { deviceId: DRUMS_TRIM_ID, paramId: 'gain-level', value: -12 };

/** Plan, persist for approval, and read the measured preview the approval shows. */
async function approvalMeasuredPreview(revision: string) {
    const planned = await parsePromptToActions(PROMPT, getProjectContext(), undefined, revision);
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
    clearPendingActionConfirmations();
    agentRunLifecycle.clear();
    resetAiWorkflowCommandPreflightFixture();
    commandTrackDefaultsPort.setTrackColorProvider(null);
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
            expect(getAgentApprovalView({ confirmationId: reproposed.confirmationId })?.measuredPreview).toBeNull();
        }
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

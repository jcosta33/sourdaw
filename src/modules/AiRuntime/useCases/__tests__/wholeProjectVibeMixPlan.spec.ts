import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { planPromptActions } from '../planPromptActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    createHostedToolPlanningResponder,
    createProviderToolPlanningResponder,
    decodeHostedProviderUserMessage,
    decodeProviderPlanningFixtureContext,
    type ProviderPlanCall,
} from './providerToolPlanningFixture';

const PROMPT =
    'Make the second chorus hit harder without changing any lead-vocal state, the tempo map, or the master chain.';

const providerPlan = [
    {
        name: 'automateTrackGainRange',
        arguments: {
            trackIds: ['bus-drums', 'bus-bass'],
            sectionName: 'Chorus Two',
            gainDb: 1.5,
        },
    },
] as const;

const providerScope = {
    targetIds: ['bus-drums', 'bus-bass'],
    targetRanges: [{ startBeat: 56, endBeat: 72 }],
    protectedTargetIds: ['track-lead-vocal', 'clip-locked-lead-vocal', 'track-master', 'project:tempo-map'],
    protectedRanges: [],
};

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
    };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createProviderPlanFromUserMessage(userMessage: string) {
    const context = decodeProviderPlanningFixtureContext(userMessage);
    const capability = context.capabilityData.wholeProjectVibeMixCapability;
    if (!isRecord(capability) || capability.actionType !== 'automateTrackGainRange') {
        throw new TypeError('Expected app-owned whole-project vibe-mix capability');
    }
    const targetSection = capability.targetSection;
    const exactTargetIds = capability.exactTargetIds;
    const allowedRelativeGainDbValues = capability.allowedRelativeGainDbValues;
    if (
        !isRecord(targetSection) ||
        typeof targetSection.name !== 'string' ||
        !Array.isArray(exactTargetIds) ||
        !exactTargetIds.every((trackId) => typeof trackId === 'string') ||
        !Array.isArray(allowedRelativeGainDbValues) ||
        allowedRelativeGainDbValues.length !== 1 ||
        typeof allowedRelativeGainDbValues[0] !== 'number'
    ) {
        throw new TypeError('Expected exact target and bounded gain candidates');
    }
    return [
        {
            name: capability.actionType,
            arguments: {
                trackIds: exactTargetIds,
                sectionName: targetSection.name,
                gainDb: allowedRelativeGainDbValues[0],
            },
        },
    ];
}

function createTrack(id: string, name: string, kind: Track['kind']): Track {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function getConfirmationId(): string {
    return (
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
        ''
    );
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

function getWebLlmUserMessage(): string {
    const userMessage: unknown = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1];
    if (typeof userMessage !== 'string') {
        throw new TypeError('Expected one WebLLM user message');
    }
    return userMessage;
}

function getWebLlmSystemPrompt(): string {
    const systemPrompt: unknown = runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[0];
    if (typeof systemPrompt !== 'string') {
        throw new TypeError('Expected one WebLLM system prompt');
    }
    return systemPrompt;
}

function configureWebProviderPlan(
    transform: (plan: readonly ProviderPlanCall[]) => readonly ProviderPlanCall[] = (plan) => plan
): void {
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt: string, userMessage: string) => {
        const context = decodeProviderPlanningFixtureContext(userMessage);
        const plan = context.hasCommandCatalogReceipt
            ? transform(createProviderPlanFromUserMessage(userMessage))
            : transform(providerPlan);
        return Promise.resolve(createProviderToolPlanningResponder(plan, providerScope)(userMessage));
    });
}

function planPromptWithProviderBudget(input: { prompt: string; signal?: AbortSignal }) {
    return planPromptActions({
        ...input,
        onProviderAttempt: () => ({ status: 'admitted' }),
    });
}

function getGainLanes() {
    return automationStore.value?.lanes.filter((lane) => lane.parameterId === 'gain') ?? [];
}

function expectExactGainAutomation(): void {
    const liftedGain = 0.8 * 10 ** (1.5 / 20);
    expect(getGainLanes()).toEqual([
        expect.objectContaining({
            id: 'auto-gain-bus-drums',
            trackId: 'bus-drums',
            parameterName: 'Drum Bus Gain',
            points: [
                { beat: 0, value: 0.8, curve: 'step', tension: 0 },
                { beat: 56, value: liftedGain, curve: 'step', tension: 0 },
                { beat: 72, value: 0.8, curve: 'step', tension: 0 },
            ],
        }),
        expect.objectContaining({
            id: 'auto-gain-bus-bass',
            trackId: 'bus-bass',
            parameterName: 'Bass Bus Gain',
            points: [
                { beat: 0, value: 0.8, curve: 'step', tension: 0 },
                { beat: 56, value: liftedGain, curve: 'step', tension: 0 },
                { beat: 72, value: 0.8, curve: 'step', tension: 0 },
            ],
        }),
    ]);
}

describe('whole-project vibe-mix planning', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        configureWebProviderPlan();
        runtimeMocks.fetch.mockImplementation((_input, init) => {
            const userMessage = decodeHostedProviderUserMessage(init);
            const context = decodeProviderPlanningFixtureContext(userMessage);
            const plan = context.hasCommandCatalogReceipt
                ? createProviderPlanFromUserMessage(userMessage)
                : providerPlan;
            return Promise.resolve(createHostedToolPlanningResponder(plan, providerScope)(userMessage));
        });
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('whole-project vibe-mix test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        const drumBus = createTrack('bus-drums', 'Drum Bus', 'bus');
        const bassBus = createTrack('bus-bass', 'Bass Bus', 'bus');
        const leadVocal = createTrack('track-lead-vocal', 'Lead Vocal', 'audio');
        leadVocal.clips = [
            {
                id: 'clip-locked-lead-vocal',
                trackId: leadVocal.id,
                name: 'Locked Lead Vocal Comp',
                startBeat: 0,
                endBeat: 80,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ffffff',
                locked: true,
                muted: false,
            },
        ];
        leadVocal.devices = [
            {
                id: 'device-lead-vocal-compressor',
                type: 'builtin-compressor',
                name: 'Lead Vocal Compressor',
                bypassed: false,
                parameterValues: { threshold: -18 },
            },
        ];
        const backingVocal = createTrack('track-backing-vocal', 'Backing Vocal', 'audio');
        const master = createTrack('track-master', 'Master', 'master');
        master.devices = [
            {
                id: 'device-master-limiter',
                type: 'crust',
                name: 'Master Limiter',
                bypassed: false,
                parameterValues: { ceiling: -1 },
            },
        ];
        trackStore.set({
            tracks: [drumBus, bassBus, leadVocal, backingVocal, master],
            selectedTrackId: null,
            ghostClips: [],
        });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-verse-two', name: 'Verse Two', startBeat: 16, endBeat: 32, color: '#ffffff' },
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 32, endBeat: 48, color: '#ffffff' },
                { id: 'section-bridge', name: 'Bridge', startBeat: 48, endBeat: 56, color: '#ffffff' },
                { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72, color: '#ffffff' },
                { id: 'section-outro', name: 'Outro', startBeat: 72, endBeat: 80, color: '#ffffff' },
            ],
        });
        automationStore.set({ lanes: [] });
        transportStore.set({
            ...defaultTransportState,
            tempo: 124,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('decomposes EX-02 into a revision-bearing bounded plan with neighbors, roles, strategy, and accepted decisions', async () => {
        const { result, projectRevision } = await planPromptWithProviderBudget({ prompt: PROMPT });
        const plan = result.wholeProjectVibeMixPlan;
        if (!plan) {
            throw new Error('Expected one structured whole-project vibe-mix plan');
        }

        expect(plan.schemaVersion).toBe(1);
        expect(plan.baseRevision).toBe(projectRevision);
        expect(plan.productionVision).toContain('Chorus Two');
        expect(plan.globalConstraints.map((constraint) => constraint.id)).toEqual([
            'track-lead-vocal',
            'clip-locked-lead-vocal',
            'track-master',
            'project:tempo-map',
        ]);
        expect(plan.sectionMap).toEqual({
            target: { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
            previous: { id: 'section-bridge', name: 'Bridge', startBeat: 48, endBeat: 56 },
            next: { id: 'section-outro', name: 'Outro', startBeat: 72, endBeat: 80 },
        });
        expect(plan.trackRoles).toEqual([
            { trackId: 'bus-drums', trackName: 'Drum Bus', role: 'impact-bus' },
            { trackId: 'bus-bass', trackName: 'Bass Bus', role: 'impact-bus' },
            { trackId: 'track-lead-vocal', trackName: 'Lead Vocal', role: 'protected-lead-vocal' },
            { trackId: 'track-master', trackName: 'Master', role: 'protected-master' },
        ]);
        expect(plan.dynamicTrajectory).toEqual({
            gainDb: 1.5,
            startBeat: 56,
            endBeat: 72,
            before: 'preserve-current',
            inside: 'lift-impact-buses',
            after: 'restore-current',
        });
        expect(plan.strategy.routing).toBe('preserve-existing');
        expect(plan.strategy.devices).toBe('preserve-existing');
        expect(plan.strategy.automation).toContain('Drum Bus and Bass Bus');
        expect(plan.acceptedDecisions).toContain('Preserve every lead-vocal property and automation lane.');
        expect(plan.acceptedDecisions).toContain('Preserve every explicit clip lock.');
        expect(plan.acceptedDecisions).toContain('Preserve the tempo map.');
        expect(plan.acceptedDecisions).toContain('Preserve the master chain.');
        expect(plan.commandBatch).toEqual(result.actions);
        expect(runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1]).toContain('revision_and_selection');
        expect(runtimeMocks.generateWebLlmCompletion.mock.calls[0]?.[1]).toContain('documentIdentityEpoch');
    });

    it('selects the actual second chorus without counting a pre-chorus substring impostor', async () => {
        markerStore.set({
            ...markerStore.value!,
            sections: [
                ...markerStore.value!.sections,
                { id: 'section-pre-chorus', name: 'Pre-Chorus', startBeat: 28, endBeat: 32, color: '#ffffff' },
            ],
        });

        const { result } = await planPromptWithProviderBudget({ prompt: PROMPT });

        expect(result.wholeProjectVibeMixPlan?.sectionMap).toEqual({
            target: { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
            previous: { id: 'section-bridge', name: 'Bridge', startBeat: 48, endBeat: 56 },
            next: { id: 'section-outro', name: 'Outro', startBeat: 72, endBeat: 80 },
        });
    });

    it('sends the provider the revision-bound app-owned candidate scope and bounded relative-gain capability', async () => {
        const { projectRevision } = await planPromptWithProviderBudget({ prompt: PROMPT });
        const userMessage = getWebLlmUserMessage();
        const systemPrompt = getWebLlmSystemPrompt();
        const planningContext = decodeProviderPlanningFixtureContext(userMessage);

        expect(systemPrompt).toContain(
            'Each target ID must correspond to a target the user actually referenced by literal ID, unique exact name, or explicit selection.'
        );
        expect(planningContext.revision).toBe(projectRevision);
        expect(planningContext.capabilityData.wholeProjectVibeMixCapability).toMatchObject({
            targetSection: { id: 'section-chorus-two', name: 'Chorus Two', startBeat: 56, endBeat: 72 },
            exactTargetIds: ['bus-drums', 'bus-bass'],
            allowedRelativeGainDbValues: [1.5],
            protectedObjectIds: ['track-lead-vocal', 'clip-locked-lead-vocal', 'track-master', 'project:tempo-map'],
            constraints: { preserveRouting: true, preserveDevices: true, requireFreshConfirmation: true },
        });
    });

    it('confirms, atomically commits, receipts, and whole-group undoes and redoes only the section gain trajectory', async () => {
        const tracksBefore = structuredClone(trackStore.value?.tracks);
        const sectionsBefore = structuredClone(markerStore.value?.sections);
        const transportBefore = structuredClone(transportStore.value);

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        if (!confirmation) {
            throw new Error('Expected one fresh EX-02 confirmation');
        }
        expect(confirmation.executionMode).toBe('atomic');
        expect(confirmation.risk?.level).toBe('authority-sensitive');
        expect(confirmation.affectedIds).toEqual(['bus-drums', 'bus-bass', 'section-chorus-two']);
        expect(confirmation.protectedUnchanged).toEqual([
            { id: 'track-lead-vocal', name: 'Lead Vocal' },
            { id: 'clip-locked-lead-vocal', name: 'Locked Lead Vocal Comp (locked clip)' },
            { id: 'track-master', name: 'Master chain' },
            { id: 'project:tempo-map', name: 'Tempo map' },
        ]);
        expect(confirmation.actions).toEqual([
            {
                type: 'automateTrackGainRange',
                payload: {
                    trackIds: ['bus-drums', 'bus-bass'],
                    sectionName: 'Chorus Two',
                    gainDb: 1.5,
                    sectionId: 'section-chorus-two',
                    startBeat: 56,
                    endBeat: 72,
                    expectedTracks: [
                        {
                            trackId: 'bus-drums',
                            trackName: 'Drum Bus',
                            gain: 0.8,
                            automationMode: 'read',
                            frozen: false,
                        },
                        {
                            trackId: 'bus-bass',
                            trackName: 'Bass Bus',
                            gain: 0.8,
                            automationMode: 'read',
                            frozen: false,
                        },
                    ],
                    expectedSection: { name: 'Chorus Two', startBeat: 56, endBeat: 72 },
                },
            },
        ]);
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(proposal?.content).toContain(`Whole-project plan (schema 1, revision ${confirmation.projectRevision})`);
        expect(proposal?.content).toContain('Section map: target "Chorus Two" (section-chorus-two) beats 56–72');
        expect(proposal?.content).toContain('routing preserve-existing; devices preserve-existing');
        expect(proposal?.content).toContain('Stop after one previewable proposal');
        expect(proposal?.content).not.toMatch(/\b(?:I heard|I listened|I auditioned|I judged)\b/iu);

        const revisionBefore = captureProjectRevision();
        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(revisionBefore);
        expectExactGainAutomation();
        const drumLane = getGainLanes().find((lane) => lane.trackId === 'bus-drums');
        if (!drumLane) {
            throw new Error('Expected the committed Drum Bus gain lane');
        }
        expect(getAutomationValueAtBeat(drumLane.id, 55.999)).toBe(0.8);
        expect(getAutomationValueAtBeat(drumLane.id, 56)).toBe(0.8 * 10 ** (1.5 / 20));
        expect(getAutomationValueAtBeat(drumLane.id, 71.999)).toBe(0.8 * 10 ** (1.5 / 20));
        expect(getAutomationValueAtBeat(drumLane.id, 72)).toBe(0.8);
        expect(trackStore.value?.tracks).toEqual(tracksBefore);
        expect(markerStore.value?.sections).toEqual(sectionsBefore);
        expect(transportStore.value).toEqual(transportBefore);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Affected IDs: bus-drums, bus-bass, section-chorus-two');
        expect(receipt?.content).toContain('Protected unchanged: "Lead Vocal" (track-lead-vocal)');
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(getGainLanes()).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expectExactGainAutomation();
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('normalizes hosted OpenAI-compatible planning to the same action and terminal state', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        const providerRequest = getHostedRequestBody();
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('bus-drums');
        expect(providerRequest).toContain('section-chorus-two');
        expect(providerRequest).toContain('revision_and_selection');
        expect(providerRequest).toContain('wholeProjectVibeMixCapability');
        expect(providerRequest).toContain('allowedRelativeGainDbValues');
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions[0]).toMatchObject({
            type: 'automateTrackGainRange',
            payload: {
                trackIds: ['bus-drums', 'bus-bass'],
                sectionId: 'section-chorus-two',
                startBeat: 56,
                endBeat: 72,
                gainDb: 1.5,
            },
        });

        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expectExactGainAutomation();
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
    });

    it('rejects provider target enlargement, protected targeting, and policy enlargement before confirmation', async () => {
        const invalidPlans = [
            [{ ...providerPlan[0], arguments: { ...providerPlan[0].arguments, trackIds: ['bus-drums'] } }],
            [
                {
                    ...providerPlan[0],
                    arguments: {
                        ...providerPlan[0].arguments,
                        trackIds: ['bus-drums', 'bus-bass', 'track-lead-vocal'],
                    },
                },
            ],
            [{ ...providerPlan[0], arguments: { ...providerPlan[0].arguments, gainDb: 3 } }],
        ];
        for (const invalidPlan of invalidPlans) {
            configureWebProviderPlan(() => invalidPlan);
            await sendChatMessage(PROMPT);
            expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
            expect(getGainLanes()).toEqual([]);
            expect(undoStore.value?.past).toEqual([]);
            chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        }
    });

    it('fails closed when section identity, gain headroom, automation ownership, or role identity is not exact', async () => {
        markerStore.set({
            ...markerStore.value!,
            sections: markerStore.value!.sections.filter((section) => section.id !== 'section-chorus-one'),
        });
        await sendChatMessage(PROMPT);
        expect(getConfirmationId()).toBe('');

        markerStore.set({
            ...markerStore.value!,
            sections: [
                { id: 'section-chorus-one', name: 'Chorus One', startBeat: 32, endBeat: 48, color: '#ffffff' },
                ...markerStore.value!.sections,
            ],
        });
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'bus-drums' ? { ...track, gain: FADER_MAX_GAIN } : track
            ),
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        await sendChatMessage(PROMPT);
        expect(getConfirmationId()).toBe('');

        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'bus-drums' ? { ...track, gain: 0.8 } : track
            ),
        });
        automationStore.set({
            lanes: [
                {
                    id: 'existing-drum-gain',
                    trackId: 'bus-drums',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        await sendChatMessage(PROMPT);
        expect(getConfirmationId()).toBe('');

        automationStore.set({ lanes: [] });
        trackStore.set({
            ...trackStore.value!,
            tracks: [...trackStore.value!.tracks, createTrack('bus-drums-parallel', 'Drum Bus', 'bus')],
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
        await sendChatMessage(PROMPT);
        expect(getConfirmationId()).toBe('');
    });

    it('returns a no-write cancellation when stopped before provider planning', async () => {
        const aborter = new AbortController();
        aborter.abort();

        const { result } = await planPromptActions({ prompt: PROMPT, signal: aborter.signal });

        expect(result.actions).toEqual([]);
        expect(result.wholeProjectVibeMixPlan).toBeUndefined();
        expect(getGainLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects a stale confirmation without partial lanes or receipt', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'bus-bass' ? { ...track, automationMode: 'off' } : track
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getGainLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
    });

    it('aborts a failed atomic store write without lane, receipt, or undo residue', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        const originalSet = automationStore.set.bind(automationStore);
        vi.spyOn(automationStore, 'set').mockImplementationOnce((state) => {
            originalSet(state);
            throw new Error('injected vibe-plan persistence failure');
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'failed', reason: 'injected vibe-plan persistence failure' });
        expect(getGainLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
        vi.mocked(automationStore.set).mockRestore();
    });

    it('preserves collaborator lane edits and keeps the whole undo group retryable', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const committed = structuredClone(automationStore.value);
        const drumLane = getGainLanes().find((lane) => lane.trackId === 'bus-drums');
        if (!drumLane) {
            throw new Error('Expected Drum Bus gain automation lane');
        }
        automationStore.set({
            lanes: automationStore.value!.lanes.map((lane) => {
                if (lane.id !== drumLane.id) {
                    return lane;
                }
                return {
                    ...lane,
                    points: lane.points.map((point, index) => {
                        if (index !== 1) {
                            return point;
                        }
                        return { ...point, value: point.value - 0.01 };
                    }),
                };
            }),
        });
        const collaboratorState = structuredClone(automationStore.value);
        const pastBeforeConflict = structuredClone(undoStore.value?.past);

        await undo();

        expect(automationStore.value).toEqual(collaboratorState);
        expect(undoStore.value?.past).toEqual(pastBeforeConflict);
        expect(undoStore.value?.future).toEqual([]);

        automationStore.set(committed);
        await undo();
        expect(getGainLanes()).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);
    });
});

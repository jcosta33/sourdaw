import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, runtimeGraphTopology, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
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
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const PROMPT = 'Lower every vocal send to the Hall by 3 dB only in verse two.';

type ProviderCall = { name: string; arguments: Record<string, unknown> };

const providerPlan: ProviderCall[] = [
    {
        name: 'automateSendRange',
        arguments: {
            trackIds: ['track-lead-vocal', 'track-backing-vocal'],
            busId: 'bus-hall',
            sectionName: 'Verse Two',
            reductionDb: 3,
        },
    },
];

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        getAllSidechainRoutes: vi.fn(() => []),
        resolveToasterPadBinding: vi.fn(() => null),
        sendLevels: new Map<string, number>(),
        setSend: vi.fn((trackId: string, busId: string, level: number) => {
            runtimeMocks.sendLevels.set(`${trackId}:${busId}`, level);
        }),
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

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    setSend: runtimeMocks.setSend,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function getProviderSection(userMessage: string, section: string): Record<string, unknown> {
    const match = new RegExp(String.raw`^${section}:\n(?<payload>.+)$`, 'mu').exec(userMessage);
    const payload = match?.groups?.payload;
    if (!payload) {
        throw new TypeError(`Expected ${section} in provider request`);
    }
    const parsed: unknown = JSON.parse(payload);
    if (!isRecord(parsed)) {
        throw new TypeError(`Expected object-shaped ${section}`);
    }
    return parsed;
}

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    if (!isRecord(request) || !isUnknownArray(request.messages)) {
        throw new TypeError('Expected hosted provider messages');
    }
    const userMessage = request.messages.find(
        (message) => isRecord(message) && message.role === 'user' && typeof message.content === 'string'
    );
    if (!isRecord(userMessage) || typeof userMessage.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return userMessage.content;
}

function getCommandBatchScope(plan: readonly ProviderCall[]): {
    targetIds: string[];
    targetRanges: Array<{ startBeat: number; endBeat: number }>;
    protectedTargetIds: [];
    protectedRanges: [];
} {
    const targetIds = new Set<string>();
    for (const call of plan) {
        const trackIds = call.arguments.trackIds;
        if (isUnknownArray(trackIds)) {
            for (const trackId of trackIds) {
                if (typeof trackId === 'string') {
                    targetIds.add(trackId);
                }
            }
        }
        if (typeof call.arguments.busId === 'string') {
            targetIds.add(call.arguments.busId);
        }
    }
    return {
        targetIds: [...targetIds],
        targetRanges: [{ startBeat: 16, endBeat: 32 }],
        protectedTargetIds: [],
        protectedRanges: [],
    };
}

function asCommandBatchProposal(plan: readonly ProviderCall[]): ProviderCall[] {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan.map((call) => ({ name: call.name, arguments: call.arguments })),
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Lower exactly the admitted vocal sends to Hall by 3 dB in Verse Two.',
                    constraints: ['Leave sends outside Verse Two unchanged.'],
                    scope: getCommandBatchScope(plan),
                    capabilityIds: ['automateSendRange'],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate the exact vocal tracks, Hall bus, section, and 3 dB reduction.'],
                    stoppingConditions: ['Stop if application validation fails.'],
                },
            },
        },
    ];
}

function catalogDiscoveryPlan(): ProviderCall[] {
    return [
        {
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['automateSendRange'] },
        },
    ];
}

function getApplicationToolReceipts(userMessage: string): unknown[] {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    if (!isUnknownArray(evidence.receipts)) {
        throw new TypeError('Expected serialized application tool receipts in provider request');
    }
    const receiptSummary = evidence.receipts.find(
        (receipt) =>
            isRecord(receipt) &&
            receipt.id === 'application-tool-loop' &&
            isRecord(receipt.summary) &&
            receipt.summary.truncated === false &&
            typeof receipt.summary.value === 'string'
    );
    if (!isRecord(receiptSummary) || !isRecord(receiptSummary.summary)) {
        throw new TypeError('Expected application tool receipt context in provider request');
    }
    const summary = receiptSummary.summary;
    if (summary.truncated !== false || typeof summary.value !== 'string') {
        throw new TypeError('Expected complete application tool receipt context in provider request');
    }
    const payload = summary.value.split('\n').at(-1);
    const parsed: unknown = payload ? JSON.parse(payload) : null;
    if (!isRecord(parsed) || !isUnknownArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

function assertDiscoveredCommandSchema(userMessage: string): void {
    const discoveryReceipt = getApplicationToolReceipts(userMessage).find(
        (receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover'
    );
    if (
        !isRecord(discoveryReceipt) ||
        discoveryReceipt.status !== 'success' ||
        discoveryReceipt.turn !== 1 ||
        !isRecord(discoveryReceipt.data) ||
        discoveryReceipt.data.schema !== 'sourdaw.agent-tool-catalog' ||
        discoveryReceipt.data.schemaVersion !== 1 ||
        discoveryReceipt.data.category !== 'command' ||
        discoveryReceipt.data.truncated !== false ||
        !isUnknownArray(discoveryReceipt.data.items)
    ) {
        throw new TypeError('Expected a successful complete command catalog discovery receipt');
    }
    const schema = discoveryReceipt.data.items.find(
        (item) =>
            isRecord(item) &&
            isRecord(item.function) &&
            item.function.name === 'automateSendRange' &&
            isRecord(item.function.parameters)
    );
    if (!schema) {
        throw new TypeError('Expected disclosed automateSendRange command schema');
    }
}

function createTurnTrackedWebLlmResponder(
    buildPlan: (userMessage: string) => ProviderCall[] = () => providerPlan
): (systemPrompt: string, userMessage: string) => Promise<string> {
    let turn = 0;
    return (_systemPrompt, userMessage) => {
        turn += 1;
        if (turn > 2) {
            throw new Error('Expected exactly two WebLLM provider turns');
        }
        if (turn === 1) {
            return Promise.resolve(JSON.stringify(catalogDiscoveryPlan()));
        }
        assertDiscoveredCommandSchema(userMessage);
        return Promise.resolve(JSON.stringify(asCommandBatchProposal(buildPlan(userMessage))));
    };
}

function toolCallsResponse(calls: readonly ProviderCall[]): Response {
    return new Response(
        JSON.stringify({
            choices: [
                {
                    finish_reason: 'tool_calls',
                    message: {
                        tool_calls: calls.map((call) => ({
                            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                        })),
                    },
                },
            ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
}

function createTurnTrackedHostedResponder(): (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> {
    let turn = 0;
    return (_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        turn += 1;
        if (turn > 2) {
            throw new Error('Expected exactly two hosted provider turns');
        }
        const userMessage = getHostedUserMessage(init.body);
        if (turn === 1) {
            return Promise.resolve(toolCallsResponse(catalogDiscoveryPlan()));
        }
        assertDiscoveredCommandSchema(userMessage);
        return Promise.resolve(toolCallsResponse(asCommandBatchProposal(providerPlan)));
    };
}

function createTrack(id: string, name: string, kind: Track['kind'] = 'audio'): Track {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
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

function getWebLlmUserMessage(): string {
    const userMessage: unknown = vi.mocked(generateWebLlmCompletion).mock.calls.at(-1)?.[1];
    if (typeof userMessage !== 'string') {
        throw new TypeError('Expected final WebLLM planning request');
    }
    return userMessage;
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls.at(-1)?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected final hosted provider planning request body');
    }
    return body;
}

function getSendLanes() {
    return automationStore.value?.lanes.filter((lane) => lane.parameterId === 'send:bus-hall') ?? [];
}

function expectExactAutomation(): void {
    const factor = 10 ** (-3 / 20);
    expect(getSendLanes()).toEqual([
        expect.objectContaining({
            id: 'auto-send-track-lead-vocal-bus-hall',
            trackId: 'track-lead-vocal',
            parameterName: 'Send: Hall',
            points: [
                { beat: 0, value: 0.5, curve: 'step', tension: 0 },
                { beat: 16, value: 0.5 * factor, curve: 'step', tension: 0 },
                { beat: 32, value: 0.5, curve: 'step', tension: 0 },
            ],
        }),
        expect.objectContaining({
            id: 'auto-send-track-backing-vocal-bus-hall',
            trackId: 'track-backing-vocal',
            parameterName: 'Send: Hall',
            points: [
                { beat: 0, value: 0.25, curve: 'step', tension: 0 },
                { beat: 16, value: 0.25 * factor, curve: 'step', tension: 0 },
                { beat: 32, value: 0.25, curve: 'step', tension: 0 },
            ],
        }),
    ]);
}

describe('verse Hall send automation workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockImplementation(createTurnTrackedWebLlmResponder());
        runtimeMocks.fetch.mockImplementation(createTurnTrackedHostedResponder());
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('verse Hall automation workflow test');
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
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const lead = createTrack('track-lead-vocal', 'Lead Vocal');
        lead.sends = [
            { busId: 'bus-hall', level: 0.5, preFader: false },
            { busId: 'bus-plate', level: 0.2, preFader: false },
        ];
        const backing = createTrack('track-backing-vocal', 'Backing Vocal');
        backing.sends = [{ busId: 'bus-hall', level: 0.25, preFader: true }];
        const spoken = createTrack('track-spoken-word', 'Spoken Word');
        spoken.sends = [{ busId: 'bus-hall', level: 0.4, preFader: false }];
        trackStore.set({
            tracks: [
                lead,
                backing,
                spoken,
                createTrack('bus-hall', 'Hall', 'bus'),
                createTrack('bus-plate', 'Plate', 'bus'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        markerStore.set({
            markers: [],
            sections: [
                { id: 'section-verse-one', name: 'Verse One', startBeat: 0, endBeat: 16, color: '#ffffff' },
                { id: 'section-verse-two', name: 'Verse Two', startBeat: 16, endBeat: 32, color: '#ffffff' },
                { id: 'section-chorus', name: 'Chorus', startBeat: 32, endBeat: 48, color: '#ffffff' },
            ],
        });
        automationStore.set({ lanes: [] });
        runtimeMocks.sendLevels.clear();
        runtimeMocks.sendLevels.set('track-lead-vocal:bus-hall', 0.5);
        runtimeMocks.sendLevels.set('track-backing-vocal:bus-hall', 0.25);
        runtimeMocks.sendLevels.set('track-spoken-word:bus-hall', 0.4);
        transportStore.set({ ...defaultTransportState });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        markerStore.set({ markers: [], sections: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds the exact vocal set, Hall, section bounds, and relative dB change before confirmation', async () => {
        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions).toEqual([
            {
                type: 'automateSendRange',
                payload: {
                    trackIds: ['track-lead-vocal', 'track-backing-vocal'],
                    busId: 'bus-hall',
                    busName: 'Hall',
                    sectionName: 'Verse Two',
                    sectionId: 'section-verse-two',
                    startBeat: 16,
                    endBeat: 32,
                    reductionDb: 3,
                    expectedSends: [
                        { trackId: 'track-lead-vocal', level: 0.5, preFader: false },
                        { trackId: 'track-backing-vocal', level: 0.25, preFader: true },
                    ],
                    expectedSection: { name: 'Verse Two', startBeat: 16, endBeat: 32 },
                },
            },
        ]);
    });

    it('confirms, atomically commits, receipts, undoes, and redoes only the Verse Two vocal send rides', async () => {
        const tracksBefore = structuredClone(trackStore.value?.tracks);
        const sectionsBefore = structuredClone(markerStore.value?.sections);

        await sendChatMessage(PROMPT);

        const providerRequest = getWebLlmUserMessage();
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-lead-vocal');
        expect(providerRequest).toContain('track-backing-vocal');
        expect(providerRequest).toContain('track-spoken-word');
        expect(providerRequest).toContain('bus-hall');
        expect(providerRequest).toContain('verse two');
        expect(providerRequest).not.toContain('section-verse-two');
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation).toMatchObject({
            executionMode: 'atomic',
            risk: { level: 'authority-sensitive' },
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain('Lower sends to "Hall" (bus-hall) by 3 dB only in Verse Two beats 16–32');
        expect(proposal?.content).toContain('"Lead Vocal" (track-lead-vocal) 0.5→');
        expect(proposal?.content).toContain('"Backing Vocal" (track-backing-vocal) 0.25→');
        expect(proposal?.content).toContain('Risk: authority-sensitive');
        const revisionBefore = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(revisionBefore);
        expectExactAutomation();
        const leadLane = getSendLanes().find((lane) => lane.trackId === 'track-lead-vocal');
        if (!leadLane) {
            throw new Error('Expected the committed lead-vocal send lane');
        }
        expect(getAutomationValueAtBeat(leadLane.id, 15.999)).toBe(0.5);
        expect(getAutomationValueAtBeat(leadLane.id, 16)).toBe(0.5 * 10 ** (-3 / 20));
        expect(getAutomationValueAtBeat(leadLane.id, 31.999)).toBe(0.5 * 10 ** (-3 / 20));
        expect(getAutomationValueAtBeat(leadLane.id, 32)).toBe(0.5);
        expect(trackStore.value?.tracks).toEqual(tracksBefore);
        expect(markerStore.value?.sections).toEqual(sectionsBefore);
        expect(runtimeMocks.sendLevels).toEqual(
            new Map([
                ['track-lead-vocal:bus-hall', 0.5],
                ['track-backing-vocal:bus-hall', 0.25],
                ['track-spoken-word:bus-hall', 0.4],
            ])
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain(
            'Affected IDs: track-lead-vocal, track-backing-vocal, bus-hall, section-verse-two'
        );
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toHaveLength(1);
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(getSendLanes()).toEqual([]);
        expect(trackStore.value?.tracks).toEqual(tracksBefore);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expectExactAutomation();
        expect(trackStore.value?.tracks).toEqual(tracksBefore);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('grounds the hosted OpenAI-compatible fixture to the same normalized action and terminal lanes', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        const providerRequest = getHostedRequestBody();
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('track-lead-vocal');
        expect(providerRequest).toContain('track-backing-vocal');
        expect(providerRequest).toContain('bus-hall');
        expect(providerRequest).toContain('verse two');
        expect(providerRequest).not.toContain('section-verse-two');
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        expect(confirmation?.actions[0]).toMatchObject({
            type: 'automateSendRange',
            payload: {
                trackIds: ['track-lead-vocal', 'track-backing-vocal'],
                busId: 'bus-hall',
                sectionId: 'section-verse-two',
                startBeat: 16,
                endBeat: 32,
                reductionDb: 3,
            },
        });

        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expectExactAutomation();
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
    });

    it('rejects provider enlargement beyond every track whose name and Hall send match vocal', async () => {
        runtimeMocks.generateWebLlmCompletion.mockImplementation(
            createTurnTrackedWebLlmResponder(() => [
                {
                    ...providerPlan[0],
                    arguments: {
                        ...providerPlan[0].arguments,
                        trackIds: [...providerPlan[0].arguments.trackIds, 'track-spoken-word'],
                    },
                },
            ])
        );
        const tracksBefore = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(getSendLanes()).toEqual([]);
        expect(trackStore.value?.tracks).toEqual(tracksBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('fails closed before confirmation when an exact vocal target has automation off', async () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-backing-vocal' ? { ...track, automationMode: 'off' } : track
            ),
        });

        await sendChatMessage(PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(getSendLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects stale confirmation when a collaborator changes one guarded Hall send', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-backing-vocal'
                    ? {
                          ...track,
                          sends: track.sends.map((send) =>
                              send.busId === 'bus-hall' ? { ...send, level: 0.3 } : send
                          ),
                      }
                    : track
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getSendLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-backing-vocal')?.sends[0]?.level).toBe(0.3);
    });

    it('rejects stale confirmation when a collaborator turns automation off for one vocal', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) =>
                track.id === 'track-backing-vocal' ? { ...track, automationMode: 'off' } : track
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getSendLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).not.toContain('Outcome: committed');
    });

    it('aborts the automation write without receipt or undo when its store write fails', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        const originalSet = automationStore.set.bind(automationStore);
        vi.spyOn(automationStore, 'set').mockImplementationOnce((state) => {
            originalSet(state);
            throw new Error('injected automation persistence failure');
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toEqual({ status: 'failed', reason: 'injected automation persistence failure' });
        expect(getSendLanes()).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
        vi.mocked(automationStore.set).mockRestore();
    });

    it('preserves collaborator lane edits and keeps grouped undo retryable', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(getConfirmationId());
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const committed = structuredClone(automationStore.value);
        const leadLane = getSendLanes()[0];
        if (!leadLane) {
            throw new Error('Expected Lead Vocal Hall automation lane');
        }
        automationStore.set({
            lanes: automationStore.value!.lanes.map((lane) =>
                lane.id === leadLane.id
                    ? {
                          ...lane,
                          points: lane.points.map((point, index) =>
                              index === 1 ? { ...point, value: point.value + 0.01 } : point
                          ),
                      }
                    : lane
            ),
        });
        const collaboratorState = structuredClone(automationStore.value);
        const pastBeforeConflict = structuredClone(undoStore.value?.past);

        await undo();

        expect(automationStore.value).toEqual(collaboratorState);
        expect(undoStore.value?.past).toEqual(pastBeforeConflict);
        expect(undoStore.value?.future).toEqual([]);

        automationStore.set(committed);
        await undo();
        expect(getSendLanes()).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);
    });
});

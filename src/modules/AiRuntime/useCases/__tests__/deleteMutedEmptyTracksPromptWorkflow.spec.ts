import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, vcaGroupStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
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

const PROMPT = 'Delete all muted empty tracks, but preserve buses and groups.';

const providerPlan = [
    { name: 'removeTrack', arguments: { trackId: 'track-muted-audio' } },
    { name: 'removeTrack', arguments: { trackId: 'track-muted-midi' } },
] as const;

type ProviderCall = { name: string; arguments: Readonly<Record<string, unknown>> };

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        backend,
        ensureTrackStrip: vi.fn(),
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        removeBusStrip: vi.fn(),
        removeTrackStrip: vi.fn(),
        resolveToasterPadBinding: vi.fn(() => null),
        setTrackGain: vi.fn(),
        setTrackMute: vi.fn(),
        setTrackOutput: vi.fn(),
        setTrackPan: vi.fn(),
        setTrackSoloGate: vi.fn(),
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
    ensureTrackStrip: runtimeMocks.ensureTrackStrip,
    removeBusStrip: runtimeMocks.removeBusStrip,
    removeTrackStrip: runtimeMocks.removeTrackStrip,
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackOutput: runtimeMocks.setTrackOutput,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createClip(trackId: string): Track['clips'][number] {
    return {
        id: `clip-${trackId}`,
        trackId,
        name: 'Existing clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrack({
    id,
    name,
    kind = 'audio',
    muted = false,
    clips = [],
}: {
    id: string;
    name: string;
    kind?: Track['kind'];
    muted?: boolean;
    clips?: Track['clips'];
}): Track {
    return {
        id,
        name,
        kind,
        muted,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips,
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

function getConfirmation() {
    const confirmationId = chatStore.value?.messages.find(
        (message) => message.pendingActionConfirmationId
    )?.pendingActionConfirmationId;
    return getPendingActionConfirmation(confirmationId ?? '');
}

function getTrack(trackId: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected track ${trackId}`);
    }
    return track;
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function getApplicationToolReceipts(userMessage: string): unknown[] {
    const evidence = getProviderSection(userMessage, 'relevant_evidence');
    if (!Array.isArray(evidence.receipts)) {
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
    const parsed: unknown = JSON.parse(String(receiptSummary.summary.value).split('\n').at(-1) ?? '');
    if (!isRecord(parsed) || !Array.isArray(parsed.receipts)) {
        throw new TypeError('Expected serialized application tool receipt list');
    }
    return parsed.receipts;
}

function assertDiscoveredCommandSchemas(userMessage: string, names: readonly string[]): void {
    const discovery = getApplicationToolReceipts(userMessage).find(
        (receipt) => isRecord(receipt) && receipt.toolName === 'agent.catalog.discover'
    );
    if (
        !isRecord(discovery) ||
        discovery.status !== 'success' ||
        discovery.turn !== 1 ||
        !isRecord(discovery.data) ||
        discovery.data.schema !== 'sourdaw.agent-tool-catalog' ||
        discovery.data.schemaVersion !== 1 ||
        discovery.data.category !== 'command' ||
        discovery.data.truncated !== false ||
        !Array.isArray(discovery.data.items)
    ) {
        throw new TypeError('Expected a successful complete command catalog discovery receipt');
    }
    const disclosedNames = new Set(
        discovery.data.items.flatMap((item) =>
            isRecord(item) && isRecord(item.function) && typeof item.function.name === 'string'
                ? [item.function.name]
                : []
        )
    );
    for (const name of names) {
        if (!disclosedNames.has(name)) {
            throw new TypeError(`Expected disclosed command schema for ${name}`);
        }
    }
}

function asCommandBatchProposal(plan: readonly ProviderCall[]): ProviderCall[] {
    return [
        {
            name: 'command.batch.propose',
            arguments: {
                commands: plan.map((call) => ({ name: call.name, arguments: call.arguments })),
                plan: {
                    semantic: { classification: 'simple', uncertainty: [] },
                    objective: 'Delete exactly the muted empty ordinary tracks.',
                    constraints: ['Preserve buses and groups.'],
                    scope: {
                        targetIds: plan.flatMap((call) =>
                            typeof call.arguments.trackId === 'string' ? [call.arguments.trackId] : []
                        ),
                        targetRanges: [],
                        protectedTargetIds: ['bus-muted-empty', 'group-muted-empty'],
                        protectedRanges: [],
                    },
                    capabilityIds: [...new Set(plan.map((call) => call.name))],
                    assetIds: [],
                    alternatives: [],
                    validationStrategy: ['Validate muted, empty, ordinary-track identity before deletion.'],
                    stoppingConditions: ['Stop if any target is nonempty, unmuted, a bus, or a group.'],
                },
            },
        },
    ];
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

function getHostedUserMessage(body: string): string {
    const request: unknown = JSON.parse(body);
    const message =
        isRecord(request) && Array.isArray(request.messages)
            ? request.messages.find(
                  (entry) => isRecord(entry) && entry.role === 'user' && typeof entry.content === 'string'
              )
            : undefined;
    if (!isRecord(message) || typeof message.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return message.content;
}

function setProviderPlan(plan: readonly ProviderCall[]): void {
    const names = [...new Set(plan.map((call) => call.name))];
    let webLlmTurn = 0;
    runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) => {
        webLlmTurn += 1;
        if (webLlmTurn > 2) {
            throw new Error('Expected exactly two WebLLM provider turns');
        }
        if (webLlmTurn === 1) {
            return Promise.resolve(
                JSON.stringify([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }])
            );
        }
        assertDiscoveredCommandSchemas(userMessage, names);
        return Promise.resolve(JSON.stringify(asCommandBatchProposal(plan)));
    });
    let hostedTurn = 0;
    runtimeMocks.fetch.mockImplementation((_input, init) => {
        if (typeof init?.body !== 'string') {
            throw new TypeError('Expected hosted provider request body');
        }
        hostedTurn += 1;
        if (hostedTurn > 2) {
            throw new Error('Expected exactly two hosted provider turns');
        }
        if (hostedTurn === 1) {
            return Promise.resolve(
                toolCallsResponse([{ name: 'agent.catalog.discover', arguments: { category: 'command', names } }])
            );
        }
        assertDiscoveredCommandSchemas(getHostedUserMessage(init.body), names);
        return Promise.resolve(toolCallsResponse(asCommandBatchProposal(plan)));
    });
}

describe('delete muted empty tracks prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.removeTrackStrip.mockReset();
        runtimeMocks.backend.value = 'webllm';
        setProviderPlan(providerPlan);
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('delete muted empty tracks prompt workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        vcaGroupStore.set({ groups: [] });
        const nonemptyId = 'track-muted-nonempty';
        trackStore.set({
            tracks: [
                createTrack({ id: 'track-muted-audio', name: 'Muted Audio', muted: true }),
                createTrack({ id: 'track-muted-midi', name: 'Muted MIDI', kind: 'midi', muted: true }),
                createTrack({ id: 'bus-muted-empty', name: 'Muted Bus', kind: 'bus', muted: true }),
                createTrack({ id: 'group-muted-empty', name: 'Muted Group', kind: 'folder', muted: true }),
                createTrack({
                    id: nonemptyId,
                    name: 'Muted Nonempty',
                    muted: true,
                    clips: [createClip(nonemptyId)],
                }),
                createTrack({ id: 'track-unmuted-empty', name: 'Unmuted Empty' }),
                createTrack({ id: 'master', name: 'Master', kind: 'master', muted: true }),
            ],
            selectedTrackId: null,
            ghostClips: [],
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
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        vcaGroupStore.set({ groups: [] });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('compiles the exact app-owned target set into one guarded destructive confirmation', async () => {
        await sendChatMessage(PROMPT);

        expect(generateWebLlmCompletion).toHaveBeenCalledOnce();
        const request = vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[1];
        expect(request).toContain(PROMPT);
        expect(request).toContain('track-muted-audio');
        expect(request).toContain('track-muted-midi');
        expect(request).toContain('bus-muted-empty');
        expect(request).toContain('group-muted-empty');
        expect(request).toContain('track-muted-nonempty');
        expect(request).toContain('track-unmuted-empty');
        expect(getConfirmation()?.actions).toEqual([
            {
                type: 'removeTrack',
                payload: {
                    trackId: 'track-muted-audio',
                    expectedKind: 'audio',
                    expectedMuted: true,
                    expectedClipIds: [],
                    expectedAlternativeClipIds: [],
                    expectedVcaGroupId: null,
                    expectedVcaMembershipGroupIds: [],
                },
            },
            {
                type: 'removeTrack',
                payload: {
                    trackId: 'track-muted-midi',
                    expectedKind: 'midi',
                    expectedMuted: true,
                    expectedClipIds: [],
                    expectedAlternativeClipIds: [],
                    expectedVcaGroupId: null,
                    expectedVcaMembershipGroupIds: [],
                },
            },
        ]);
        expect(getConfirmation()).toMatchObject({
            executionMode: 'atomic',
            risk: { level: 'destructive-reversible' },
            protectedUnchanged: [
                { id: 'bus-muted-empty', name: 'Muted Bus' },
                { id: 'group-muted-empty', name: 'Muted Group' },
            ],
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === getConfirmation()?.id
        );
        expect(proposal?.content).toContain('Remove track "Muted Audio"');
        expect(proposal?.content).toContain('Remove track "Muted MIDI"');
        expect(proposal?.content).toContain('Risk: destructive-reversible');
        expect(proposal?.content).toContain('Protected unchanged: "Muted Bus" (bus-muted-empty)');
        expect(proposal?.content).toContain('"Muted Group" (group-muted-empty)');
        expect(undoStore.value?.past).toEqual([]);
    });

    it('protects a muted track whose inactive alternative contains recorded content', async () => {
        const hiddenContentTrackId = 'track-muted-hidden-content';
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: [
                ...state.tracks,
                {
                    ...createTrack({ id: hiddenContentTrackId, name: 'Muted Hidden Content', muted: true }),
                    activeAlternativeId: 'alt-empty',
                    alternatives: [
                        { id: 'alt-empty', name: 'Empty', clips: [] },
                        {
                            id: 'alt-recorded',
                            name: 'Recorded',
                            clips: [createClip(hiddenContentTrackId)],
                        },
                    ],
                },
            ],
        });

        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();

        expect(
            confirmation?.actions.flatMap((action) => (action.type === 'removeTrack' ? [action.payload.trackId] : []))
        ).toEqual(['track-muted-audio', 'track-muted-midi']);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack(hiddenContentTrackId).alternatives[1]?.clips.map((clip) => clip.id)).toEqual([
            `clip-${hiddenContentTrackId}`,
        ]);
        expect(runtimeMocks.removeTrackStrip).toHaveBeenCalledTimes(2);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalledWith(hiddenContentTrackId);
    });

    it('confirms one atomic batch, receipts exact removals, and round-trips project and runtime through undo and redo', async () => {
        const protectedBefore = structuredClone(
            trackStore.value?.tracks.filter(
                (track) => track.id !== 'track-muted-audio' && track.id !== 'track-muted-midi'
            )
        );
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        const revisionBefore = captureProjectRevision();

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(captureProjectRevision()).not.toBe(revisionBefore);
        expect(trackStore.value?.tracks.map((track) => track.id)).toEqual(protectedBefore?.map((track) => track.id));
        expect(runtimeMocks.removeTrackStrip).toHaveBeenNthCalledWith(1, 'track-muted-audio');
        expect(runtimeMocks.removeTrackStrip).toHaveBeenNthCalledWith(2, 'track-muted-midi');
        expect(runtimeMocks.removeBusStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(2);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain('Affected IDs: track-muted-audio');
        expect(receipt?.content).toContain('Affected IDs: track-muted-midi');
        expect(receipt?.content).toContain('Protected unchanged: "Muted Bus" (bus-muted-empty)');

        await undo();

        expect(getTrack('track-muted-audio').muted).toBe(true);
        expect(getTrack('track-muted-midi').muted).toBe(true);
        expect(
            trackStore.value?.tracks.filter((track) => !protectedBefore?.some((item) => item.id === track.id))
        ).toHaveLength(2);
        expect(runtimeMocks.ensureTrackStrip).toHaveBeenCalledWith('track-muted-audio');
        expect(runtimeMocks.ensureTrackStrip).toHaveBeenCalledWith('track-muted-midi');

        await redo();

        expect(trackStore.value?.tracks).toEqual(protectedBefore);
        expect(runtimeMocks.removeTrackStrip).toHaveBeenCalledTimes(4);
    });

    it('atomically restores exact sibling routing when one deleted target routed to the other', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-muted-audio' ? { ...track, outputId: 'track-muted-midi' } : track
            ),
        });
        const beforeDeletion = structuredClone(trackStore.value);

        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmation()?.id ?? '' });
        runtimeMocks.ensureTrackStrip.mockClear();

        await undo();

        expect(trackStore.value).toEqual(beforeDeletion);
        expect(runtimeMocks.ensureTrackStrip).toHaveBeenCalledWith('track-muted-audio');
        expect(runtimeMocks.ensureTrackStrip).toHaveBeenCalledWith('track-muted-midi');
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    it('normalizes the hosted provider to the same immutable target set and receipt', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        expect(getHostedRequestBody()).toContain(PROMPT);
        expect(getHostedRequestBody()).toContain('track-muted-audio');
        expect(getConfirmation()?.actions).toEqual([
            {
                type: 'removeTrack',
                payload: {
                    trackId: 'track-muted-audio',
                    expectedKind: 'audio',
                    expectedMuted: true,
                    expectedClipIds: [],
                    expectedAlternativeClipIds: [],
                    expectedVcaGroupId: null,
                    expectedVcaMembershipGroupIds: [],
                },
            },
            {
                type: 'removeTrack',
                payload: {
                    trackId: 'track-muted-midi',
                    expectedKind: 'midi',
                    expectedMuted: true,
                    expectedClipIds: [],
                    expectedAlternativeClipIds: [],
                    expectedVcaGroupId: null,
                    expectedVcaMembershipGroupIds: [],
                },
            },
        ]);

        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Affected IDs: track-muted-audio');
        expect(receipt?.content).toContain('Protected unchanged: "Muted Bus" (bus-muted-empty)');
    });

    it('rejects provider enlargement or omission without a proposal or write', async () => {
        const initialTracks = structuredClone(trackStore.value?.tracks);
        for (const plan of [
            [...providerPlan, { name: 'removeTrack', arguments: { trackId: 'track-unmuted-empty' } }],
            [providerPlan[0]],
        ]) {
            setProviderPlan(plan);
            chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
            clearPendingActionConfirmations();

            await sendChatMessage(PROMPT);

            expect(getConfirmation()).toBeNull();
            expect(trackStore.value?.tracks).toEqual(initialTracks);
            expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
            expect(undoStore.value?.past).toEqual([]);
        }
    });

    it('fails closed when one semantic target has VCA structural membership', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-muted-audio' ? { ...track, vcaGroupId: 'vca-1' } : track
            ),
        });
        vcaGroupStore.set({
            groups: [{ id: 'vca-1', name: 'Band', gain: 1, muted: false, trackIds: ['track-muted-audio'] }],
        });
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts the atomic batch when a later target no longer matches its app-owned guards', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => (track.id === 'track-muted-midi' ? { ...track, muted: false } : track)),
        });
        const beforeConfirm = structuredClone(trackStore.value?.tracks);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toMatchObject({
            status: 'failed',
        });

        expect(trackStore.value?.tracks).toEqual(beforeConfirm);
        expect(getTrack('track-muted-audio').muted).toBe(true);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts before deletion when alternative content is added after confirmation', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-muted-midi'
                    ? {
                          ...track,
                          alternatives: [
                              {
                                  id: 'alt-collaborator',
                                  name: 'Collaborator take',
                                  clips: [createClip(track.id)],
                              },
                          ],
                      }
                    : track
            ),
        });
        const beforeConfirm = structuredClone(trackStore.value?.tracks);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toMatchObject({
            status: 'failed',
        });

        expect(trackStore.value?.tracks).toEqual(beforeConfirm);
        expect(getTrack('track-muted-audio').muted).toBe(true);
        expect(getTrack('track-muted-midi').alternatives[0]?.clips.map((clip) => clip.id)).toEqual([
            'clip-track-muted-midi',
        ]);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts before deletion when authoritative VCA membership is added after confirmation', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        vcaGroupStore.set({
            groups: [{ id: 'vca-1', name: 'Band', gain: 1, muted: false, trackIds: ['track-muted-midi'] }],
        });
        const beforeConfirm = structuredClone(trackStore.value?.tracks);
        const vcaBeforeConfirm = structuredClone(vcaGroupStore.value);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toMatchObject({
            status: 'failed',
        });

        expect(trackStore.value?.tracks).toEqual(beforeConfirm);
        expect(vcaGroupStore.value).toEqual(vcaBeforeConfirm);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reconciles a transient later runtime-removal failure without partial graph residue', async () => {
        runtimeMocks.removeTrackStrip
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('transient graph removal failure');
            })
            .mockImplementationOnce(() => undefined);
        await sendChatMessage(PROMPT);

        await expect(confirmPendingChatActions({ confirmationId: getConfirmation()?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks.some((track) => track.id === 'track-muted-audio')).toBe(false);
        expect(trackStore.value?.tracks.some((track) => track.id === 'track-muted-midi')).toBe(false);
        expect(runtimeMocks.removeTrackStrip).toHaveBeenCalledTimes(3);
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('reports persistent runtime teardown failure as committed with manual repair instead of false clean success', async () => {
        runtimeMocks.removeTrackStrip
            .mockImplementationOnce(() => undefined)
            .mockImplementation(() => {
                throw new Error('persistent graph removal failure');
            });
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks.some((track) => track.id === 'track-muted-audio')).toBe(false);
        expect(trackStore.value?.tracks.some((track) => track.id === 'track-muted-midi')).toBe(false);
        expect(runtimeMocks.removeTrackStrip).toHaveBeenCalledTimes(3);
        expect(undoStore.value?.past).toHaveLength(2);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('committed with a follow-up warning');
        expect(receipt?.content).toContain('manual repair required');
        expect(receipt?.content).toContain('Do not retry these confirmed actions');
        expect(receipt?.error).toContain('manual repair required');
    });

    it('keeps grouped redo retryable when a collaborator adds alternative content to one restored target', async () => {
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmation()?.id ?? '' });
        await undo();
        runtimeMocks.removeTrackStrip.mockClear();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected restored track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-muted-midi'
                    ? {
                          ...track,
                          alternatives: [
                              {
                                  id: 'alt-collaborator',
                                  name: 'Collaborator take',
                                  clips: [createClip(track.id)],
                              },
                          ],
                      }
                    : track
            ),
        });
        const beforeRedo = structuredClone(trackStore.value?.tracks);
        const futureBefore = structuredClone(undoStore.value?.future);

        await redo();

        expect(trackStore.value?.tracks).toEqual(beforeRedo);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.future).toEqual(futureBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps grouped redo atomic when a collaborator assigns one restored target to a VCA', async () => {
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmation()?.id ?? '' });
        await undo();
        runtimeMocks.removeTrackStrip.mockClear();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected restored track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-muted-midi' ? { ...track, vcaGroupId: 'vca-1' } : track
            ),
        });
        vcaGroupStore.set({
            groups: [{ id: 'vca-1', name: 'Band', gain: 1, muted: false, trackIds: ['track-muted-midi'] }],
        });
        const beforeRedo = structuredClone(trackStore.value?.tracks);
        const vcaBeforeRedo = structuredClone(vcaGroupStore.value);
        const historyBeforeRedo = structuredClone(undoStore.value);

        await redo();

        expect(trackStore.value?.tracks).toEqual(beforeRedo);
        expect(vcaGroupStore.value).toEqual(vcaBeforeRedo);
        expect(runtimeMocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(undoStore.value).toEqual(historyBeforeRedo);
    });

    it('refuses grouped undo when a collaborator occupies one deleted identity', async () => {
        await sendChatMessage(PROMPT);
        await confirmPendingChatActions({ confirmationId: getConfirmation()?.id ?? '' });
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected committed track state');
        }
        const collaboratorTrack = createTrack({
            id: 'track-muted-audio',
            name: 'Collaborator Replacement',
            muted: false,
        });
        trackStore.set({ ...state, tracks: [...state.tracks, collaboratorTrack] });
        const beforeUndo = structuredClone(trackStore.value?.tracks);
        const historyBeforeUndo = structuredClone(undoStore.value);
        runtimeMocks.ensureTrackStrip.mockClear();

        await undo();

        expect(getTrack('track-muted-audio')).toEqual(collaboratorTrack);
        expect(trackStore.value?.tracks.some((track) => track.id === 'track-muted-midi')).toBe(false);
        expect(trackStore.value?.tracks).toEqual(beforeUndo);
        expect(runtimeMocks.ensureTrackStrip).not.toHaveBeenCalled();
        expect(runtimeMocks.ensureTrackStrip).not.toHaveBeenCalledWith('track-muted-audio');
        expect(undoStore.value).toEqual(historyBeforeUndo);
    });
});

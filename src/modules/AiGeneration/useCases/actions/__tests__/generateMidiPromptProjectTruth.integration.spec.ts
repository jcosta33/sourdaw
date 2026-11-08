import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    type TrackAddedPayload,
    type TrackRemovedPayload,
    type TrackSelectionChangedPayload,
} from '#/modules/Arrangement/events';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { aiStore } from '../../../stores/aiStore';

let handlerMaps: typeof import('#/app/getProductionCommandHandlerMaps');
let devicePorts: typeof import('#/app/registerDeviceEnginePorts');
let arrangement: typeof import('#/modules/Arrangement/useCases');
let arrangementStores: typeof import('#/modules/Arrangement/stores');
let command: typeof import('#/modules/Command/useCases');
let commandStores: typeof import('#/modules/Command/stores');
let crdt: typeof import('#/modules/CrdtDocument/useCases');
let crdtStores: typeof import('#/modules/CrdtDocument/stores');
let midiStores: typeof import('#/modules/MIDI/stores');
let aiRuntime: typeof import('#/modules/AiRuntime/useCases');
let generate: typeof import('../handleGenerateMidiPrompt');
let cancel: typeof import('../cancelProcessingTask');

const ENDPOINT = 'http://127.0.0.1:43871/v1/chat/completions';
const PROMPT = '[Instrument: Acoustic Piano] a sparse four-note phrase';
const NOTES = [
    { pitch: 48, velocity: 101, start_beat: 0.5, duration_beats: 0.5 },
    { pitch: 61, velocity: 79, start_beat: 1.25, duration_beats: 0.75 },
    { pitch: 67, velocity: 94, start_beat: 2.5, duration_beats: 1.25 },
    { pitch: 72, velocity: 63, start_beat: 4, duration_beats: 0.5 },
];
const EXPECTED_NOTES = NOTES.map((note) => ({
    pitch: note.pitch,
    velocity: note.velocity,
    startBeat: note.start_beat,
    duration: note.duration_beats,
}));

function deferred<T>() {
    return Promise.withResolvers<T>();
}

function providerResponse(finishReason: 'stop' | 'length' = 'stop'): Response {
    const text = JSON.stringify({ notes: NOTES });
    const frames = [text.slice(0, 37), text.slice(37)].map((content) => ({
        id: 'midi-response',
        choices: [{ delta: { content }, finish_reason: null }],
    }));
    const terminal = { id: 'midi-response', choices: [{ delta: {}, finish_reason: finishReason }] };
    const wire = `${[...frames, terminal].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(wire);
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 19));
                controller.enqueue(bytes.slice(19));
                controller.close();
            },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
    );
}

type ArrangementEvents = {
    'track.added': TrackAddedPayload;
    'track.removed': TrackRemovedPayload;
    'track.selectionChanged': TrackSelectionChangedPayload;
};
type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

describe('free-text MIDI generation project authority', () => {
    let response: ReturnType<typeof deferred<Response>>;
    let requestStarted: ReturnType<typeof deferred<void>>;
    let requests: string[];
    let pending: Promise<void> | undefined;
    let unsubscribeHistory: (() => void) | undefined;
    let trackEvents: ReturnType<typeof createEventBus<ArrangementEvents>>;
    let notifications: ReturnType<typeof createEventBus<NotificationEvents>>;

    beforeAll(async () => {
        // Load the owning production graph once, before importing its public barrels.
        handlerMaps = await import('#/app/getProductionCommandHandlerMaps');
        devicePorts = await import('#/app/registerDeviceEnginePorts');
        arrangement = await import('#/modules/Arrangement/useCases');
        arrangementStores = await import('#/modules/Arrangement/stores');
        command = await import('#/modules/Command/useCases');
        commandStores = await import('#/modules/Command/stores');
        crdt = await import('#/modules/CrdtDocument/useCases');
        crdtStores = await import('#/modules/CrdtDocument/stores');
        midiStores = await import('#/modules/MIDI/stores');
        aiRuntime = await import('#/modules/AiRuntime/useCases');
        generate = await import('../handleGenerateMidiPrompt');
        cancel = await import('../cancelProcessingTask');
    }, 30_000);

    beforeEach(async () => {
        Container.clear();
        devicePorts.registerDeviceEnginePorts();
        trackEvents = createEventBus<ArrangementEvents>();
        notifications = createEventBus<NotificationEvents>();
        arrangement.setArrangementEventBus(trackEvents);
        setNotificationEventBus(notifications);
        configureAutomergeStoragePort(null);
        crdt.resetCrdtProjectAuthority('Generated MIDI authority');
        crdt.registerCrdtStorageRuntime();
        commandStores.clearHandlerRegistry();
        command.registerProductionCommandHandlers(
            handlerMaps.getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })
        );
        command.setActionHistoryMetadataPort({
            record: crdt.recordActionHistoryEntry,
            recordBatch: crdt.recordActionHistoryEntries,
            markReverted: crdt.markActionHistoryEntryReverted,
            clear: crdt.clearActionHistory,
        });
        unsubscribeHistory = crdt.subscribeToPublishedActionHistory({
            onHistory: command.syncActionReplayMetadata,
            onRootReplaced: command.resetActionReplayAuthority,
        });
        await command.executeAppAction({
            type: 'addTrack',
            payload: { id: 'target', name: 'Piano', kind: 'midi', withoutDefaultDevice: true },
        });
        await command.executeAppAction({
            type: 'addTrack',
            payload: { id: 'sentinel', name: 'Untouched', kind: 'midi', withoutDefaultDevice: true },
        });
        arrangement.selectTrack('target');
        await command.executeAppAction({ type: 'seekPlayhead', payload: { beat: 8 } });
        flushAutomergeStorageWrites();
        command.clearUndoHistory();
        crdt.clearActionHistory();
        aiStore.set({ tasks: [], isPanelOpen: false });
        await aiRuntime.configureCloudProvider({
            provider: 'openai-compatible',
            model: 'midi-test-model',
            authentication: 'none',
            apiKey: '',
            baseUrl: 'http://127.0.0.1:43871/v1',
        });
        aiRuntime.setAiBackendPreference('cloud');
        response = deferred<Response>();
        requestStarted = deferred<void>();
        requests = [];
        pending = undefined;
        // Only the external provider's HTTP transport is replaced. Routing, protocol,
        // SSE parsing, tasks, project authority, dispatch and history stay real.
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            let requestUrl: string;
            if (typeof input === 'string') {
                requestUrl = input;
            } else if (input instanceof URL) {
                requestUrl = input.href;
            } else {
                requestUrl = input.url;
            }
            if (requestUrl !== ENDPOINT || init?.method !== 'POST' || typeof init.body !== 'string') {
                throw new Error(`Unexpected provider request: ${requestUrl}`);
            }
            requests.push(init.body);
            requestStarted.resolve();
            return response.promise;
        });
    }, 30_000);

    afterEach(async () => {
        response?.resolve(providerResponse());
        await pending;
        await trackEvents?.waitForIdle();
        await notifications?.waitForIdle();
        flushAutomergeStorageWrites();
        await aiRuntime?.removeCloudProvider();
        aiRuntime?.setAiBackendPreference('auto');
        unsubscribeHistory?.();
        unsubscribeHistory = undefined;
        command?.clearUndoHistory();
        commandStores?.clearHandlerRegistry();
        crdt?.removeCrdtDoc('root');
        aiStore.set({ tasks: [], isPanelOpen: false });
        vi.unstubAllGlobals();
        Container.clear();
    });

    function truth() {
        const revision = crdt.settlePendingProjectWritesAndCaptureRevision();
        return {
            revision,
            document: JSON.stringify(crdt.getCrdtDoc('root')),
            tracks: structuredClone(arrangementStores.trackStore.value),
            midi: structuredClone(midiStores.midiStore.value),
            undo: structuredClone(commandStores.undoHistoryStore.value),
            history: structuredClone(crdtStores.actionHistoryStore.value),
            selection: structuredClone(arrangementStores.clipSelectionStore.value),
        };
    }

    async function startGeneration(): Promise<void> {
        pending = generate.handleGenerateMidiPrompt(PROMPT, 8, 0.35);
        await requestStarted.promise;
        expect(aiStore.value?.tasks).toHaveLength(1);
        expect(aiStore.value?.tasks[0]?.status).toBe('processing');
        expect(requests).toHaveLength(1);
        expect(JSON.parse(requests[0]!)).toMatchObject({ model: 'midi-test-model', stream: true });
        expect(requests[0]).toContain(PROMPT);
    }

    function generatedMaterial() {
        const clips = arrangementStores.trackStore.value?.tracks.find((track) => track.id === 'target')?.clips ?? [];
        expect(clips).toHaveLength(1);
        const clip = clips[0];
        if (!clip) {
            throw new Error('Expected the generated clip');
        }
        const notes = midiStores.midiStore.value?.notesByClipId[clip.id] ?? [];
        const root = crdt.getCrdtDoc<{
            tracks?: typeof arrangementStores.trackStore.value;
            midi?: typeof midiStores.midiStore.value;
        }>('root');
        expect(root?.tracks?.tracks.find((track) => track.id === 'target')?.clips).toEqual(clips);
        expect(root?.midi?.notesByClipId[clip.id]).toEqual(notes);
        return { clip, notes };
    }

    it('commits split hosted SSE as exact notes and one real undo/redo group', async () => {
        const before = truth();
        await startGeneration();
        expect(truth()).toEqual(before);
        response.resolve(providerResponse());
        await pending;
        const { clip, notes } = generatedMaterial();
        expect(clip).toMatchObject({ trackId: 'target', startBeat: 8, endBeat: 12.5, type: 'midi' });
        expect(
            notes.map(({ pitch, velocity, startBeat, duration }) => ({ pitch, velocity, startBeat, duration }))
        ).toEqual(EXPECTED_NOTES);
        expect(aiStore.value?.tasks[0]).toMatchObject({
            status: 'success',
            data: { clipId: clip.id, trackId: 'target', noteCount: 4 },
        });
        expect(arrangementStores.clipSelectionStore.value?.selectedClipId).toBe(clip.id);
        expect(arrangementStores.trackStore.value?.tracks.find((track) => track.id === 'sentinel')).toEqual(
            before.tracks?.tracks.find((track) => track.id === 'sentinel')
        );
        const past = commandStores.undoHistoryStore.value?.past ?? [];
        expect(past).toHaveLength(2);
        expect(past.map((entry) => entry.groupId)).toEqual([
            `ai-midi-${aiStore.value?.tasks[0]?.id}`,
            `ai-midi-${aiStore.value?.tasks[0]?.id}`,
        ]);
        const metadata = crdtStores.actionHistoryStore.value?.entries ?? [];
        expect(metadata).toHaveLength(2);
        expect(metadata.map((entry) => entry.groupId)).toEqual(past.map((entry) => entry.groupId));
        expect(crdt.getCrdtDoc<{ actionHistory?: unknown }>('root')?.actionHistory).toEqual(
            crdtStores.actionHistoryStore.value
        );
        await command.undo();
        truth();
        expect(arrangementStores.trackStore.value?.tracks.find((track) => track.id === 'target')?.clips).toEqual([]);
        expect(midiStores.midiStore.value?.notesByClipId[clip.id] ?? []).toEqual([]);
        const undoneRoot = crdt.getCrdtDoc<{
            tracks?: typeof arrangementStores.trackStore.value;
            midi?: typeof midiStores.midiStore.value;
        }>('root');
        expect(undoneRoot?.tracks?.tracks.find((track) => track.id === 'target')?.clips).toEqual([]);
        expect(undoneRoot?.midi?.notesByClipId[clip.id] ?? []).toEqual([]);
        expect(undoneRoot?.tracks?.tracks.find((track) => track.id === 'sentinel')).toEqual(
            before.tracks?.tracks.find((track) => track.id === 'sentinel')
        );
        expect(commandStores.undoHistoryStore.value?.past).toEqual([]);
        await command.redo();
        truth();
        expect(generatedMaterial()).toEqual({ clip, notes });
        expect(requests).toHaveLength(1);
    });

    it('keeps a stopped task terminal when its held provider later completes', async () => {
        await startGeneration();
        cancel.cancelProcessingTask('midi-generation');
        const before = truth();
        response.resolve(providerResponse());
        await pending;
        expect(truth()).toEqual(before);
        expect(aiStore.value?.tasks[0]).toMatchObject({ status: 'error', error: 'Stopped by user' });
    });

    it('preserves a genuine intervening user edit without applying generated notes', async () => {
        await startGeneration();
        await command.executeAppAction({ type: 'setTrackColor', payload: { trackId: 'sentinel', color: '#123456' } });
        const afterUserEdit = truth();
        response.resolve(providerResponse());
        await pending;
        expect(truth()).toEqual(afterUserEdit);
        expect(aiStore.value?.tasks[0]).toMatchObject({
            status: 'error',
            error: expect.stringContaining('project changed'),
        });
    });

    it('cannot publish an old result into a replacement project root', async () => {
        await startGeneration();
        const original = truth();
        crdt.resetCrdtProjectAuthority('Replacement project');
        await command.executeAppAction({
            type: 'addTrack',
            payload: { id: 'target', name: 'Replacement piano', kind: 'midi', withoutDefaultDevice: true },
        });
        await command.executeAppAction({
            type: 'addTrack',
            payload: { id: 'replacement-keeper', name: 'Replacement keeper', kind: 'midi', withoutDefaultDevice: true },
        });
        arrangement.selectTrack('target');
        const replacement = truth();
        expect(replacement.revision).not.toBe(original.revision);
        expect(replacement.tracks?.tracks.find((track) => track.id === 'target')).toMatchObject({
            name: 'Replacement piano',
            kind: 'midi',
            clips: [],
        });
        response.resolve(providerResponse());
        await pending;
        expect(truth()).toEqual(replacement);
        expect(aiStore.value?.tasks[0]).toMatchObject({
            status: 'error',
            error: expect.stringContaining('project changed'),
        });
    });

    it('rejects parseable notes when the hosted stream ends at its token limit', async () => {
        const before = truth();
        await startGeneration();
        response.resolve(providerResponse('length'));
        await pending;
        expect(truth()).toEqual(before);
        expect(aiStore.value?.tasks[0]).toMatchObject({
            status: 'error',
            error: 'Hosted AI MIDI response was incomplete (token limit).',
        });
    });
});

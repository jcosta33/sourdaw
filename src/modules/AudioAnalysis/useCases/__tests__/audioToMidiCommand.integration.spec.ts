import { clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import * as storage from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    addClip,
    createTrack,
    getArrangementHandlers,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    getMacroHandlers,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    stopMacroRecording,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDoc,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { arrangementStore, defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { handleAudioToMidi } from '../../handlers/analysis/handleAudioToMidi';
import { audioToMidi } from '../audioToMidi';
import * as onsetDetection from '../detectOnsets';
import { insertPolyphonicMidiNotes } from '../insertPolyphonicMidiNotes';

registerDeviceEnginePorts();
registerProjectSlotProjections();

const mocks = vi.hoisted(() => ({ getCachedAudioBuffer: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

class NoopArrangementEventBus {
    async emit<TEventName extends string>(_event: TEventName, _payload: unknown): Promise<void> {}
}

function projectState() {
    const document = getCrdtDoc<{ tracks?: unknown; midi?: unknown }>('root');
    if (!document) {
        throw new Error('Expected root CRDT document');
    }
    return structuredClone({
        authority: { tracks: document.tracks, midi: document.midi },
        tracks: trackStore.value,
        midi: midiStore.value,
    });
}

function midiOutput() {
    return trackStore.value?.tracks.filter((track) => track.kind === 'midi') ?? [];
}

describe('registered audio-to-MIDI committed creation', () => {
    beforeEach(() => {
        storage.configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('audio-to-MIDI integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            ...getMacroHandlers(),
            audioToMidi: handleAudioToMidi,
        });
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setArrangementEventBus(new NoopArrangementEventBus());
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'audio', kind: 'audio', name: 'Source' })],
        });
        addClip({
            id: 'source',
            trackId: 'audio',
            name: 'Phrase',
            type: 'audio',
            startBeat: 0,
            endBeat: 80,
            audioBufferId: 'buffer',
        });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
        arrangementStore.set({
            activeArrangementId: 'verse',
            arrangements: [
                {
                    id: 'verse',
                    name: 'Verse',
                    tracks: trackStore.value!,
                    midi: midiStore.value!,
                    automation: { lanes: [] },
                },
            ],
        });
        const data = Float32Array.from({ length: 44100 * 40 }, (_, frame) =>
            frame >= 11025 && frame < 22050 ? 0.8 : 0
        );
        mocks.getCachedAudioBuffer.mockReturnValue({
            sampleRate: 44100,
            duration: 40,
            length: data.length,
            getChannelData: () => data,
        });
        storage.flushAutomergeStorageWrites();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        storage.configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    async function expectRoundTrip(before: ReturnType<typeof projectState>) {
        const created = projectState();
        const entries = undoHistoryStore.value?.past ?? [];
        expect(entries.length).toBeGreaterThanOrEqual(2);
        expect(new Set(entries.map((entry) => entry.groupId)).size).toBe(1);
        expect(entries[0]?.groupId).toBeTruthy();
        expect(await undo()).toMatchObject({ headConsumed: true });
        expect(projectState()).toEqual(before);
        await redo();
        expect(projectState()).toEqual(created);
        expect(await undo()).toMatchObject({ headConsumed: true });
        expect(projectState()).toEqual(before);
    }

    it('awaits registered conversion and round-trips complete raw CRDT and store output', async () => {
        const before = projectState();
        const result = await executeAppActionBatch([
            { type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } },
        ]);
        expect(result.status).toBe('executed');
        expect(midiOutput()).toHaveLength(1);
        expect(midiOutput()[0]?.clips).toHaveLength(1);
        expect(midiStore.value?.notesByClipId[midiOutput()[0]!.clips[0]!.id]).toHaveLength(1);
        await expectRoundTrip(before);
    });

    it('waits outside a parent transaction for snapshot admission', async () => {
        let release!: () => void;
        let entered!: () => void;
        const admission = new Promise<void>((resolve) => {
            release = resolve;
        });
        const waiting = new Promise<void>((resolve) => {
            entered = resolve;
        });
        vi.spyOn(storage, 'waitForAutomergeSnapshotTransaction').mockImplementation(() => {
            expect(storage.getCurrentAutomergeStorageMutationOwner()).toBeUndefined();
            entered();
            return admission;
        });
        let settled = false;
        const conversion = executeAppAction({
            type: 'audioToMidi',
            payload: { clipId: 'source', trackId: 'audio' },
        }).then(() => {
            settled = true;
        });
        await waiting;
        expect(settled).toBe(false);
        expect(midiOutput()).toHaveLength(0);
        release();
        await conversion;
        expect(midiOutput()[0]?.clips).toHaveLength(1);
    });

    it.each(
        (['basic', 'poly'] as const).flatMap((route) =>
            (['cancel', 'source', 'tempo', 'arrangement', 'root-same-bytes', 'save'] as const).map((transition) => ({
                route,
                transition,
            }))
        )
    )(
        'keeps queued $route conversion ownership through a real $transition transition',
        async ({ route, transition }) => {
            let enter!: (owner: object) => void;
            let release!: () => void;
            const entered = new Promise<object>((resolve) => {
                enter = resolve;
            });
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const blocker = transactSnapshot(async (owner) => {
                enter(owner);
                await held;
            });
            const owner = await entered;
            const admission = vi.spyOn(storage, 'waitForAutomergeSnapshotTransaction');
            const controller = new AbortController();
            let settled = false;
            const pcm = mocks.getCachedAudioBuffer().getChannelData(0).slice();
            const projectRevision = settlePendingProjectWritesAndCaptureRevision();
            let work: Promise<boolean>;
            if (route === 'basic') {
                work = audioToMidi({ clipId: 'source', trackId: 'audio', signal: controller.signal });
            } else {
                work = insertPolyphonicMidiNotes(
                    [{ pitchMidi: 60, startTimeSeconds: 0.25, durationSeconds: 0.1, amplitude: 0.8 }],
                    { startBeat: 0, endBeat: 80, name: 'Poly', projectRevision, signal: controller.signal },
                    'audio'
                ).then((result) => result !== null);
            }
            const conversion = work.then((result) => {
                settled = true;
                return result;
            });
            let expected: ReturnType<typeof projectState>;
            try {
                await vi.waitFor(() => expect(admission).toHaveBeenCalled());
                expect(settled).toBe(false);
                expect(midiOutput()).toHaveLength(0);
                if (transition === 'cancel') {
                    controller.abort();
                }
                if (transition === 'root-same-bytes') {
                    replaceCrdtDoc({ id: 'root', doc: clone(getCrdtDoc('root')!) });
                    projectCrdtToStores({ resetProjections: true });
                } else if (transition !== 'cancel') {
                    type Root = {
                        tracks: NonNullable<typeof trackStore.value>;
                        transport: NonNullable<typeof transportStore.value>;
                        arrangements: NonNullable<typeof arrangementStore.value>;
                        projectMeta: { updatedAt: number };
                    };
                    mutateCrdtDoc<Root>({
                        id: 'root',
                        snapshotTransaction: owner,
                        changeFn: (document) => {
                            if (transition === 'source') {
                                document.tracks.tracks[0]!.clips[0]!.endBeat = 79;
                            }
                            if (transition === 'tempo') {
                                document.transport.tempo = 90;
                            }
                            if (transition === 'arrangement') {
                                document.arrangements.activeArrangementId = 'chorus';
                            }
                            if (transition === 'save') {
                                document.projectMeta.updatedAt += 1;
                            }
                        },
                    });
                    projectCrdtToStores();
                }
                expected = projectState();
            } finally {
                release();
                await blocker;
            }
            expect(await conversion).toBe(transition === 'save');
            expect(mocks.getCachedAudioBuffer().getChannelData(0)).toEqual(pcm);
            if (transition === 'save') {
                expect(midiOutput()).toHaveLength(1);
                await expectRoundTrip(expected!);
            } else {
                expect(projectState()).toEqual(expected!);
                expect(undoHistoryStore.value?.past).toEqual([]);
                expect(actionHistoryStore.value?.entries).toEqual([]);
                expect(macroStore.value?.currentRecording).toEqual([]);
            }
        }
    );

    it('rejects a frozen existing destination without partial state or history', async () => {
        setTrackStoreState({
            ...trackStore.value!,
            tracks: [
                ...trackStore.value!.tracks,
                { ...createTrack({ id: 'midi', kind: 'midi', name: 'Frozen' }), frozen: true },
            ],
        });
        storage.flushAutomergeStorageWrites();
        const before = projectState();
        expect(await audioToMidi({ clipId: 'source', trackId: 'midi' })).toBe(false);
        expect(projectState()).toEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
    });

    it('rejects mixing runtime conversion with a project action before either writes', async () => {
        const before = projectState();
        const result = await executeAppActionBatch([
            { type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } },
            { type: 'renameTrack', payload: { trackId: 'audio', name: 'Changed' } },
        ]);
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: audioToMidi',
        });
        expect(projectState()).toEqual(before);
    });

    it('reports no-op when no onset can produce a committed conversion', async () => {
        vi.spyOn(onsetDetection, 'detectOnsets').mockReturnValue([]);
        const before = projectState();
        const result = await executeAppActionBatch([
            { type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } },
        ]);
        expect(result).toMatchObject({ status: 'no-op', actions: [] });
        expect(projectState()).toEqual(before);
    });

    it('keeps all 129 notes across command chunks and complete grouped replay', async () => {
        vi.spyOn(onsetDetection, 'detectOnsets').mockReturnValue(
            Array.from({ length: 129 }, (_, index) => ({ timeSec: index * 0.15, amplitude: 0.8 }))
        );
        const before = projectState();
        expect(await audioToMidi({ clipId: 'source', trackId: 'audio' })).toBe(true);
        const clipId = midiOutput()[0]!.clips[0]!.id;
        expect(midiStore.value?.notesByClipId[clipId]).toHaveLength(129);
        expect(
            undoHistoryStore.value?.past.flatMap((entry) =>
                entry.kind === 'action' && entry.action.type === 'addNotes' ? [entry.action.payload.notes.length] : []
            )
        ).toEqual([128, 1]);
        await expectRoundTrip(before);
    });

    it('aborts all creation when the final note chunk fails after staging writes', async () => {
        vi.spyOn(onsetDetection, 'detectOnsets').mockReturnValue(
            Array.from({ length: 129 }, (_, index) => ({ timeSec: index * 0.15, amplitude: 0.8 }))
        );
        const realHandler = getMidiNoteTransformHandlers().addNotes;
        let calls = 0;
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            audioToMidi: handleAudioToMidi,
            addNotes: {
                ...realHandler,
                execute: (action, context) => {
                    realHandler.execute(action, context);
                    calls += 1;
                    return calls === 2 ? { status: 'conflict' } : undefined;
                },
            },
        });
        const before = projectState();
        expect(await audioToMidi({ clipId: 'source', trackId: 'audio' })).toBe(false);
        expect(calls).toBe(2);
        expect(projectState()).toEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
    });

    it('rolls back when cancellation arrives after notes stage but before commit', async () => {
        const controller = new AbortController();
        const handler = getMidiNoteTransformHandlers().addNotes;
        let staged = false;
        clearHandlerRegistry();
        registerHandlerMap({
            ...getArrangementHandlers(),
            ...getMidiNoteTransformHandlers(),
            audioToMidi: handleAudioToMidi,
            addNotes: {
                ...handler,
                execute: (action, context) => {
                    handler.execute(action, context);
                    staged = true;
                    controller.abort();
                    return { status: 'written' };
                },
            },
        });
        const before = projectState();
        expect(await audioToMidi({ clipId: 'source', trackId: 'audio', signal: controller.signal })).toBe(false);
        expect(staged).toBe(true);
        expect(projectState()).toEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(actionHistoryStore.value?.entries).toEqual([]);
    });

    it('round-trips polyphonic insertion including more than one notes command', async () => {
        const before = projectState();
        const result = await insertPolyphonicMidiNotes(
            Array.from({ length: 129 }, (_, index) => ({
                pitchMidi: 60,
                startTimeSeconds: index * 0.15,
                durationSeconds: 0.1,
                amplitude: 0.8,
            })),
            {
                startBeat: 0,
                endBeat: 80,
                name: 'Poly',
                projectRevision: settlePendingProjectWritesAndCaptureRevision(),
            },
            'audio'
        );
        expect(result).not.toBeNull();
        expect(midiStore.value?.notesByClipId[result!.clipId]).toHaveLength(129);
        await expectRoundTrip(before);
    });

    it('records and replays children once without rerunning transcription', async () => {
        const detector = vi.spyOn(onsetDetection, 'detectOnsets');
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        await executeAppAction({ type: 'audioToMidi', payload: { clipId: 'source', trackId: 'audio' } });
        expect(macroStore.value?.currentRecording.map((action) => action.type)).toEqual([
            'addTrack',
            'addClip',
            'addNotes',
        ]);
        expect(actionHistoryStore.value?.entries.map((entry) => entry.actionKind)).toEqual([
            'addTrack',
            'addClip',
            'addNotes',
        ]);
        stopMacroRecording('Conversion');
        const calls = detector.mock.calls.length;
        await undo();
        expect(midiOutput()).toHaveLength(0);
        await executeAppAction({ type: 'playMacro', payload: { macroId: macroStore.value!.macros[0]!.id } });
        expect(detector).toHaveBeenCalledTimes(calls);
        expect(midiOutput()).toHaveLength(1);
        expect(midiOutput()[0]?.clips).toHaveLength(1);
        expect(midiStore.value?.notesByClipId[midiOutput()[0]!.clips[0]!.id]).toHaveLength(1);
    });
});

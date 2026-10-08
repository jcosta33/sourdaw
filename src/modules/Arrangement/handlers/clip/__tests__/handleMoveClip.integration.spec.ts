import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleMoveClip atomic integration', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('move clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({
            id: 'clip-1',
            name: 'Verse Lead',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });
        const source = TrackDummy.create({ id: 'track-1', name: 'Vocals', clips: [clip] });
        const destination = TrackDummy.create({ id: 'track-2', name: 'Comp', kind: 'audio', clips: [] });
        trackStore.set({ tracks: [source, destination], selectedTrackId: source.id, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        automationStore.set({
            lanes: [
                {
                    id: 'lane-clip-gain',
                    trackId: 'track-1',
                    clipId: 'clip-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { id: 'point-1', beat: 1, value: 0.25, curve: 'linear', tension: 0 },
                        { id: 'point-2', beat: 2, value: 0.75, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
    });

    it('preserves legacy source presence through move, undo, and redo across tempo', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'initial', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slower', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const before = trackStore.value!;
        const original = before.tracks[0]!.clips[0]!;
        trackStore.set({
            ...before,
            tracks: [{ ...before.tracks[0]!, clips: [{ ...original, audioOffsetBeats: 2 }] }, before.tracks[1]!],
        });
        const action = { type: 'moveClip' as const, payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 6 } };

        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(trackStore.value?.tracks[1]?.clips[0]).toMatchObject({ audioOffsetSeconds: 1, audioOffsetBeats: 1 });

        await undo();
        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored?.audioOffsetBeats).toBe(2);
        expect(Object.hasOwn(restored ?? {}, 'audioOffsetSeconds')).toBe(false);
        const rawUndo = getCrdtDoc<{ tracks: { tracks: { clips: { audioOffsetSeconds?: number }[] }[] } }>('root');
        expect(Object.hasOwn(rawUndo?.tracks.tracks[0]?.clips[0] ?? {}, 'audioOffsetSeconds')).toBe(false);

        await redo();
        expect(trackStore.value?.tracks[1]?.clips[0]).toMatchObject({ audioOffsetSeconds: 1, audioOffsetBeats: 1 });
    });

    it('keeps two recorded take depths in seconds through a tempo-changing move and undo', async () => {
        tempoMapStore.set({
            changes: [
                { id: 'initial', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slower', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        const before = trackStore.value!;
        const original = before.tracks[0]!.clips[0]!;
        trackStore.set({
            ...before,
            tracks: [{ ...before.tracks[0]!, clips: [{ ...original, audioOffsetBeats: 0 }] }, before.tracks[1]!],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    activeCompRegions: [],
                    takes: [0, 2].map((sourceOffsetBeats, index) => ({
                        id: `take-${index}`,
                        clipId: 'clip-1',
                        name: `Take ${index}`,
                        startBeat: 2,
                        endBeat: 10,
                        selected: false,
                        sourceOffsetBeats,
                    })),
                },
            ],
        });
        const action = { type: 'moveClip' as const, payload: { clipId: 'clip-1', trackId: 'track-1', startBeat: 6 } };

        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetSeconds)).toEqual([0, 1]);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetBeats)).toEqual([0, 1]);

        await undo();
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetBeats)).toEqual([0, 2]);
        expect(takeLaneStore.value?.lanes[0]?.takes.every((take) => !Object.hasOwn(take, 'sourceOffsetSeconds'))).toBe(
            true
        );
        const rawUndo = getCrdtDoc<{ takeLanes: { lanes: { takes: { sourceOffsetSeconds?: number }[] }[] } }>('root');
        expect(rawUndo?.takeLanes.lanes[0]?.takes.every((take) => !Object.hasOwn(take, 'sourceOffsetSeconds'))).toBe(
            true
        );

        await redo();
        expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetSeconds)).toEqual([0, 1]);

        const lane = takeLaneStore.value!.lanes[0]!;
        takeLaneStore.set({
            lanes: [{ ...lane, takes: [lane.takes[0]!, { ...lane.takes[1]!, sourceOffsetSeconds: 8 }] }],
        });
        const peerRaw = structuredClone(getCrdtDoc('root'));
        const past = undoHistoryStore.value?.past;
        await undo();
        expect(takeLaneStore.value?.lanes[0]?.takes[1]?.sourceOffsetSeconds).toBe(8);
        expect(getCrdtDoc('root')).toEqual(peerRaw);
        expect(undoHistoryStore.value?.past).toEqual(past);
    });

    it('keeps a peer source edit and the redo entry after undo', async () => {
        const action = { type: 'moveClip' as const, payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 } };
        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        await undo();

        const beforePeer = trackStore.value!;
        const sourceTrack = beforePeer.tracks[0]!;
        trackStore.set({
            ...beforePeer,
            tracks: [
                { ...sourceTrack, clips: [{ ...sourceTrack.clips[0]!, audioOffsetSeconds: 7 }] },
                beforePeer.tracks[1]!,
            ],
        });
        const peerState = trackStore.value;
        const peerRaw = structuredClone(getCrdtDoc('root'));
        const future = undoHistoryStore.value?.future;

        await redo();

        expect(trackStore.value).toBe(peerState);
        expect(getCrdtDoc('root')).toEqual(peerRaw);
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioOffsetSeconds).toBe(7);
        expect(undoHistoryStore.value?.future).toEqual(future);
        expect(undoHistoryStore.value?.past).toEqual([]);
    });

    it('commits atomically and round-trips exact track membership and geometry through undo and redo', async () => {
        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 },
        };

        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-2',
            startBeat: 16,
            endBeat: 24,
        });
        expect(automationStore.value?.lanes[0]).toMatchObject({
            id: 'lane-clip-gain',
            trackId: 'track-2',
            points: [{ beat: 15 }, { beat: 16 }],
        });

        await undo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-1',
            points: [{ beat: 1 }, { beat: 2 }],
        });

        await redo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-2',
            startBeat: 16,
            endBeat: 24,
        });
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-2',
            points: [{ beat: 15 }, { beat: 16 }],
        });
    });

    it('losslessly restores automation points that collide at the timeline origin', async () => {
        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 0 },
        };

        await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-2',
            points: [{ beat: 0 }, { beat: 0 }],
        });

        await undo();
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-1',
            points: [{ beat: 1 }, { beat: 2 }],
        });

        await redo();
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-2',
            points: [{ beat: 0 }, { beat: 0 }],
        });
    });

    it('keeps the undo entry and moved state when clip automation changed externally', async () => {
        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 },
        };
        await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
        expect(notifications).toEqual([]);

        const movedLane = automationStore.value!.lanes[0]!;
        automationStore.set({
            lanes: [{ ...movedLane, points: [{ ...movedLane.points[0]!, value: 0.9 }, movedLane.points[1]!] }],
        });

        await undo();

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]?.startBeat).toBe(16);
        expect(automationStore.value?.lanes[0]).toMatchObject({
            trackId: 'track-2',
            points: [
                { beat: 15, value: 0.9 },
                { beat: 16, value: 0.75 },
            ],
        });
        expect(notifications).toEqual([
            {
                message:
                    'Cannot undo "Move clip "Verse Lead" (clip-1) to track track-2 at beat 16": project state has changed',
                level: 'warning',
            },
        ]);
    });

    it('returns a legacy misplaced clip to its incompatible host when the rescue move is undone', async () => {
        // A project saved before the placement rule can hold an audio clip on a
        // MIDI track. The rescue move forward is legal (the audio target is
        // compatible), but its undo replays the move back onto the MIDI host —
        // a placement the forward guard refuses. The replay must return the
        // document to the state it actually held; refusing it would retain the
        // undo head in conflict and break every later Cmd+Z.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    name: 'Vocals',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'clip-1',
                            type: 'audio',
                            trackId: 'track-1',
                            startBeat: 2,
                            endBeat: 10,
                        }),
                    ],
                }),
                TrackDummy.create({ id: 'track-2', name: 'Comp', kind: 'audio', clips: [] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 },
        };
        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips).toEqual([]);

        await undo();

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });
        // The head was consumed, not retained in conflict: no refusal notice,
        // and the entry moved to the redo stack.
        expect(notifications).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
    });

    it('commits an ordinary same-host retime of a legacy misplaced clip', async () => {
        // A pre-placement-rule project can hold an audio clip on a MIDI track.
        // Retiming it on that same host changes no placement — the host is
        // whatever the document already holds — so the compatibility rule has
        // nothing to govern and the move must commit like any other retime.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    name: 'Vocals',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'clip-1',
                            type: 'audio',
                            trackId: 'track-1',
                            startBeat: 2,
                            endBeat: 10,
                        }),
                    ],
                }),
                TrackDummy.create({ id: 'track-2', name: 'Comp', kind: 'audio', clips: [] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-1', startBeat: 8 },
        };
        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });

        const host = trackStore.value?.tracks.find((track) => track.id === 'track-1');
        expect(host?.clips).toHaveLength(1);
        expect(host?.clips[0]).toMatchObject({ id: 'clip-1', trackId: 'track-1', startBeat: 8, endBeat: 16 });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips).toEqual([]);
    });

    it('restores a legacy misplaced clip through the multi-clip move inverse without stranding it', async () => {
        // The multi-clip inverse replays every moved clip through moveClip.
        // One legacy clip (audio on a MIDI track) rides along with an ordinary
        // one: the replay must return both to where the document actually
        // held them, not strand the legacy clip on the rescue target while
        // reporting the restore as written.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    name: 'Vocals',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'clip-1',
                            type: 'audio',
                            trackId: 'track-1',
                            startBeat: 2,
                            endBeat: 10,
                        }),
                    ],
                }),
                TrackDummy.create({
                    id: 'track-2',
                    name: 'Comp',
                    kind: 'audio',
                    clips: [ClipDummy.create({ id: 'clip-2', trackId: 'track-2', startBeat: 2, endBeat: 10 })],
                }),
                TrackDummy.create({ id: 'track-3', name: 'Stack', kind: 'audio', clips: [] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [
                    { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 },
                    { clipId: 'clip-2', trackId: 'track-3', startBeat: 16 },
                ],
                ripple: false,
            },
        };
        // `moveClips` is not abort-compensated, so the batch is not atomic.
        expect(await executeAppActionBatch([action], { source: 'prompt' })).toMatchObject({
            status: 'committed',
        });

        await undo();

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]).toMatchObject({
            id: 'clip-2',
            trackId: 'track-2',
            startBeat: 2,
            endBeat: 10,
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-3')?.clips).toEqual([]);
        expect(notifications).toEqual([]);
    });
});

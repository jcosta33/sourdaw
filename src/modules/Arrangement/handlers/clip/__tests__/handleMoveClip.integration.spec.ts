import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
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
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleMoveClip atomic integration', () => {
    beforeEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('move clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({
            id: 'clip-1',
            name: 'Verse Lead',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });
        const source = TrackDummy.create({ id: 'track-1', name: 'Vocals', clips: [clip] });
        const destination = TrackDummy.create({ id: 'track-2', name: 'Comp Bus', kind: 'bus', clips: [] });
        trackStore.set({ tracks: [source, destination], selectedTrackId: source.id, ghostClips: [] });
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
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
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
    });
});

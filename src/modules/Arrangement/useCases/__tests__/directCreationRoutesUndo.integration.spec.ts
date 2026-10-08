import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { __resetGainEnvelopesForTest, getEnvelope, setEnvelope } from '#/modules/Arrangement/stores/gainEnvelopeStore';
import { __resetWarpStatesForTest, getStoredWarpState, setWarpState } from '#/modules/Arrangement/stores/warpStates';
import {
    copySelectedClip,
    createTrack,
    selectClip,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { createAutomationLane, getAutomationLanes } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    registerProductionCommandHandlers,
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
import { midiStore } from '#/modules/MIDI/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// Audit #4591 — the empty-timeline menu, the empty-arrangement buttons, the
// Sends inspector's Create Bus, the Instruments and Samples tabs, the Pattern
// Browser, file and sample drops and track Import Audio create tracks and
// clips by calling `addTrack`/`addClip` directly (paste goes through
// `pasteClip`, which is built on the same `addClip`). Neither records history,
// so Undo leaves the creation and reverts the edit before it.
// Real production handlers, stores, dispatch and undo machinery.
//
// #4618 routed every listed creation/paste route through its registered
// action; each case below dispatches the exact action its surface now
// dispatches (the issue's original seam called the bare use case the route
// used to call, which by itself still records no history).

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('direct track and clip creation and Undo', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('direct creation undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });
        __resetGainEnvelopesForTest();
        __resetWarpStatesForTest();
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                createTrack({ id: 't-drums', name: 'Drums', kind: 'midi' }),
                createTrack({ id: 't-bass', name: 'Bass', kind: 'midi' }),
            ],
            selectedTrackId: 't-drums',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    const trackColor = (): string | undefined =>
        trackStore.value?.tracks.find((track) => track.id === 't-drums')?.color;

    it('undoes a track added from the empty-timeline menu', async () => {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });

        // Seam adaptation (#4618): the menu now dispatches the registered
        // addTrack action instead of calling the bare use case; dispatch the
        // exact action the surface dispatches.
        await executeAppAction({ type: 'addTrack', payload: { name: 'Audio', kind: 'audio' } });
        await undo();

        expect.soft(trackStore.value?.tracks.map((track) => track.id)).toEqual(['t-drums', 't-bass']);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a clip added from the empty-timeline menu', async () => {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });

        // Seam adaptation (#4618): the menu now dispatches the registered
        // addClip action instead of calling the bare use case; dispatch the
        // exact action the surface dispatches.
        await executeAppAction({
            type: 'addClip',
            payload: { trackId: 't-bass', startBeat: 4, endBeat: 8, name: 'New clip', type: 'midi' },
        });
        await undo();

        expect.soft(trackStore.value?.tracks.find((track) => track.id === 't-bass')?.clips).toEqual([]);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a paste dispatched from the paste routes', async () => {
        // The paste surfaces (empty-timeline menu, clip context menu, command
        // palette) dispatch the registered pasteClip action; this dispatches
        // exactly that action over a real clipboard.
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'clip-src', trackId: 't-drums', startBeat: 0, endBeat: 4, name: 'Source', type: 'midi' },
        });
        selectClip('clip-src');
        copySelectedClip();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });

        await executeAppAction({ type: 'pasteClip' });
        await undo();

        const clips = trackStore.value?.tracks.find((track) => track.id === 't-drums')?.clips ?? [];
        expect.soft(clips.map((clip) => clip.id)).toEqual(['clip-src']);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a paste together with the satellites the paste cloned onto its clip', async () => {
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'clip-src', trackId: 't-drums', startBeat: 0, endBeat: 4, name: 'Source', type: 'midi' },
        });
        setEnvelope('clip-src', {
            clipId: 'clip-src',
            enabled: true,
            points: [{ id: 'env-1', beatOffset: 0, gainDb: -3 }],
        });
        setWarpState('clip-src', {
            enabled: true,
            markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5 }],
            stretchMode: 'repitch',
            originalTempo: 120,
        });
        selectClip('clip-src');
        copySelectedClip();

        await executeAppAction({ type: 'pasteClip' });

        const pasted = trackStore.value?.tracks
            .find((track) => track.id === 't-drums')
            ?.clips.find((clip) => clip.id !== 'clip-src');
        if (!pasted) {
            throw new Error('expected the pasted clip on the drums track');
        }
        expect(getEnvelope(pasted.id)).toBeDefined();
        expect(getStoredWarpState(pasted.id)).toBeDefined();

        await undo();

        const clips = trackStore.value?.tracks.find((track) => track.id === 't-drums')?.clips ?? [];
        expect.soft(clips.map((clip) => clip.id)).toEqual(['clip-src']);
        // The pasted clip's satellites go with it; the source's stay.
        expect(getEnvelope(pasted.id)).toBeUndefined();
        expect(getStoredWarpState(pasted.id)).toBeUndefined();
        expect(getEnvelope('clip-src')).toBeDefined();
        expect(getStoredWarpState('clip-src')).toBeDefined();
    });

    it('undoes a paste together with the clip-scoped automation lane the paste cloned onto its clip', async () => {
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'clip-src', trackId: 't-drums', startBeat: 0, endBeat: 4, name: 'Source', type: 'midi' },
        });
        automationStore.set({
            lanes: [
                {
                    ...createAutomationLane('t-drums', 'volume', 'Volume', 0, 1, 'clip-src'),
                    id: 'lane-src',
                    points: [{ beat: 0, value: 0.75, curve: 'linear', tension: 0 }],
                },
            ],
        });
        selectClip('clip-src');
        copySelectedClip();

        await executeAppAction({ type: 'pasteClip' });

        const pasted = trackStore.value?.tracks
            .find((track) => track.id === 't-drums')
            ?.clips.find((clip) => clip.id !== 'clip-src');
        if (!pasted) {
            throw new Error('expected the pasted clip on the drums track');
        }
        const pastedLanes = getAutomationLanes().filter((lane) => lane.clipId === pasted.id);
        expect(pastedLanes).toHaveLength(1);
        expect(pastedLanes[0]?.id).not.toBe('lane-src');

        await undo();

        // The pasted clip's cloned lane goes with it; the source's stays.
        expect(getAutomationLanes().some((lane) => lane.clipId === pasted.id)).toBe(false);
        const sourceLane = getAutomationLanes().find((lane) => lane.id === 'lane-src');
        expect(sourceLane?.clipId).toBe('clip-src');
        expect(sourceLane?.points).toEqual([{ beat: 0, value: 0.75, curve: 'linear', tension: 0 }]);
    });

    it('undoes a paste together with the midi rows the paste cloned onto its clip', async () => {
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'clip-src', trackId: 't-drums', startBeat: 0, endBeat: 4, name: 'Source', type: 'midi' },
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'clip-src': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
            ccByClipId: { 'clip-src': [{ id: 'cc-1', controller: 11, value: 64, beat: 0, channel: 0 }] },
            pitchBendByClipId: { 'clip-src': [{ id: 'pb-1', value: 100, beat: 0, channel: 0 }] },
        });
        selectClip('clip-src');
        copySelectedClip();

        await executeAppAction({ type: 'pasteClip' });

        const pasted = trackStore.value?.tracks
            .find((track) => track.id === 't-drums')
            ?.clips.find((clip) => clip.id !== 'clip-src');
        if (!pasted) {
            throw new Error('expected the pasted clip on the drums track');
        }
        expect(midiStore.value?.notesByClipId[pasted.id]).toHaveLength(1);
        expect(midiStore.value?.ccByClipId[pasted.id]).toHaveLength(1);
        expect(midiStore.value?.pitchBendByClipId[pasted.id]).toHaveLength(1);

        await undo();

        const clips = trackStore.value?.tracks.find((track) => track.id === 't-drums')?.clips ?? [];
        expect.soft(clips.map((clip) => clip.id)).toEqual(['clip-src']);
        // The pasted clip's rows go with it — every stream the restore's
        // dropped-rows sweep retires; the source's stay.
        expect(midiStore.value?.notesByClipId[pasted.id]).toBeUndefined();
        expect(midiStore.value?.ccByClipId[pasted.id]).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId[pasted.id]).toBeUndefined();
        expect(midiStore.value?.notesByClipId['clip-src']).toHaveLength(1);
        expect(midiStore.value?.ccByClipId['clip-src']).toHaveLength(1);
        expect(midiStore.value?.pitchBendByClipId['clip-src']).toHaveLength(1);
    });

    it('undoes an import batch whose track was created solely for its clip', async () => {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });

        // The async import surfaces (file/sample/AI drops, Import Audio) land
        // a track created solely for the clip and the clip itself in one
        // executeAppActionBatch — the exact batch shape those routes compile.
        await executeAppActionBatch(
            [
                {
                    type: 'addTrack',
                    payload: {
                        id: 'track-import',
                        name: 'loop',
                        kind: 'audio',
                        color: '#000000',
                        initialAlternativeId: 'alt-import',
                    },
                },
                {
                    type: 'addClip',
                    payload: {
                        trackId: 'track-import',
                        startBeat: 0,
                        endBeat: 8,
                        name: 'loop',
                        type: 'audio',
                        audioBufferId: 'buf-1',
                    },
                },
            ],
            {
                groupId: 'import-audio-test',
                groupLabel: 'Import audio: loop',
                source: 'manual',
                requireCompensation: true,
            }
        );
        await undo();

        expect.soft(trackStore.value?.tracks.map((track) => track.id)).toEqual(['t-drums', 't-bass']);
        expect.soft(trackColor()).toBe('#222222');
    });
});

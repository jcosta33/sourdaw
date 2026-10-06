import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    gainEnvelopeStore,
    markerStore,
    trackStore,
    vcaGroupStore,
} from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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

// Audit #4591 — timeline and mixer surfaces edit project truth by calling these
// use cases directly (MarkerLane, ArrangementBar, InlineTrackName,
// TrackListView, ClipGainEnvelopeSection, the channel strip VCA menu). None of
// them records history, so Undo skips the edit and reverts the one before it.
// Real production handlers, stores, dispatch and undo machinery.
//
// #4617 routed the surfaces through `executeAppAction`; every case below
// dispatches the exact action its surface now dispatches. (The marker-rename,
// gain-envelope and Modulation-Matrix cases originally called the bare use
// cases their surfaces still called; those actions exist now, so they were
// adapted to the dispatched actions like the rest.)

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

describe('direct timeline and mixer edits and Undo', () => {
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
        resetCrdtProjectAuthority('direct edit undo integration');
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

    async function colourTrackThenEdit(edit: () => void | Promise<void>): Promise<void> {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });
        await edit();
        await undo();
    }

    it('undoes a marker deleted from the marker lane', async () => {
        markerStore.set({ markers: [{ id: 'm1', beat: 8, name: 'Chorus', color: '#f00' }], sections: [] });
        await colourTrackThenEdit(() => executeAppAction({ type: 'removeMarker', payload: { markerId: 'm1' } }));
        expect.soft(markerStore.value?.markers.map((marker) => marker.id)).toEqual(['m1']);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a marker renamed in the marker lane', async () => {
        markerStore.set({ markers: [{ id: 'm1', beat: 8, name: 'Chorus', color: '#f00' }], sections: [] });
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'renameMarker', payload: { markerId: 'm1', name: 'Bridge' } })
        );
        expect.soft(markerStore.value?.markers[0]?.name).toBe('Chorus');
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a section deleted from the arrangement bar', async () => {
        markerStore.set({
            markers: [],
            sections: [{ id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' }],
        });
        await colourTrackThenEdit(() => executeAppAction({ type: 'removeSection', payload: { sectionId: 's1' } }));
        expect.soft(markerStore.value?.sections.map((section) => section.id)).toEqual(['s1']);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a gapped section reorder instead of the edit beneath it (#4962)', async () => {
        markerStore.set({
            markers: [{ id: 'm1', beat: 20, name: 'Chorus', color: '#f00' }],
            sections: [
                { id: 's1', startBeat: 0, endBeat: 16, name: 'Intro', color: '#111' },
                { id: 's2', startBeat: 24, endBeat: 40, name: 'Verse', color: '#222' },
            ],
        });
        await colourTrackThenEdit(async () => {
            await executeAppAction({ type: 'renameMarker', payload: { markerId: 'm1', name: 'Bridge' } });
            await executeAppAction({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'right' } });
        });
        // One undo reverts the reorder exactly — both spans and the gap — while
        // the marker rename beneath it stays put.
        expect.soft(markerStore.value?.sections).toEqual([
            { id: 's1', startBeat: 0, endBeat: 16, name: 'Intro', color: '#111' },
            { id: 's2', startBeat: 24, endBeat: 40, name: 'Verse', color: '#222' },
        ]);
        expect.soft(markerStore.value?.markers[0]?.name).toBe('Bridge');
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a fractional-beat section reorder to the exact beats', async () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 's1', startBeat: 0.1, endBeat: 16.3, name: 'Intro', color: '#111' },
                { id: 's2', startBeat: 16.3, endBeat: 32.5, name: 'Verse', color: '#222' },
            ],
        });
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'reorderSection', payload: { sectionId: 's1', direction: 'right' } })
        );
        expect.soft(markerStore.value?.sections).toEqual([
            { id: 's1', startBeat: 0.1, endBeat: 16.3, name: 'Intro', color: '#111' },
            { id: 's2', startBeat: 16.3, endBeat: 32.5, name: 'Verse', color: '#222' },
        ]);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a track renamed in its header', async () => {
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'renameTrack', payload: { trackId: 't-bass', name: 'Sub' } })
        );
        expect.soft(trackStore.value?.tracks.find((track) => track.id === 't-bass')?.name).toBe('Bass');
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a track dragged to a new position', async () => {
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'reorderTrack', payload: { trackId: 't-bass', newIndex: 0 } })
        );
        expect.soft(trackStore.value?.tracks.map((track) => track.id)).toEqual(['t-drums', 't-bass']);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a clip gain envelope reset from the inspector', async () => {
        gainEnvelopeStore.set({
            envelopes: {
                'clip-vox': {
                    clipId: 'clip-vox',
                    enabled: true,
                    points: [
                        { id: 'p1', beatOffset: 0, gainDb: 0 },
                        { id: 'p2', beatOffset: 4, gainDb: -9 },
                    ],
                },
            },
        });
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'resetClipGainEnvelope', payload: { clipId: 'clip-vox' } })
        );
        expect.soft(gainEnvelopeStore.value?.envelopes['clip-vox']?.points).toHaveLength(2);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('undoes a VCA assignment toggled from the channel strip menu', async () => {
        vcaGroupStore.set({ groups: [{ id: 'vca-1', name: 'Rhythm', gain: 1, muted: false, trackIds: [] }] });
        // The strip toggles by membership: an unassigned track dispatches `assignToVca`.
        await colourTrackThenEdit(() =>
            executeAppAction({ type: 'assignToVca', payload: { trackId: 't-bass', vcaGroupId: 'vca-1' } })
        );
        expect.soft(vcaGroupStore.value?.groups[0]?.trackIds).toEqual([]);
        expect.soft(trackColor()).toBe('#222222');
    });
});

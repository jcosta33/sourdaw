import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    addWarpMarker,
    clipSelectionStore,
    defaultClipSelectionState,
    defaultGainEnvelopeStoreState,
    gainEnvelopeStore,
    trackStore,
    warpStates,
    type Clip,
    type Track,
} from '#/modules/Arrangement/stores';
import { addGainEnvelopePoint, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    setCommandEventBus,
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

import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const TRACK_ID = 'track-keys';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createClipFixture(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: TRACK_ID,
        name: `Clip ${id}`,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function createTrackFixture(clips: readonly Clip[]): Track {
    return {
        id: TRACK_ID,
        name: 'Keys',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [...clips],
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function trackClips(): Clip[] {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? [];
}

function deleteKeyDescriptor(): KeyDescriptor {
    return { key: 'Delete', mod: false, shift: false, alt: false, repeat: false, isInput: false };
}

/**
 * Issue #3627 end to end: the Delete key travels the whole chain a user's
 * keypress does — the real shortcut store's shipped `editing.deleteSelection`
 * binding resolves the key, `deleteSelectionShortcut` dispatches one
 * registered `removeClip` per selected clip under one fresh undo group, the
 * real arrangement handlers retire the clips with their MIDI data and
 * satellites, and a single real `undo()` replays the grouped inverses so both
 * clips return with their notes, pitch bend, gain envelope, warp marker, and
 * ripple geometry. Nothing here is mocked: the grouped-dispatch seam the unit
 * specs pin with a mocked `executeUserAppAction` is the real kernel here.
 *
 * Lives in CommandInterface because `handleKeydown` is internal to this module
 * (no barrel exports it), and test files may not deep-import foreign module
 * paths — the arrangement-side integration specs cannot reach it.
 */
describe('handleKeydown deleteSelection integration (issue #3627)', () => {
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
        // The delete path never emits on the command bus; this only satisfies
        // the DI token so the real handleKeydown resolves a real container.
        setCommandEventBus({ emit: async () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('keyboard delete selection integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        trackStore.set({
            tracks: [createTrackFixture([createClipFixture('clip-a', 0, 4), createClipFixture('clip-b', 4, 8)])],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-a': [{ id: 'note-a-1', pitch: 60, startBeat: 0, duration: 2, velocity: 100 }],
                'clip-b': [{ id: 'note-b-1', pitch: 64, startBeat: 0.5, duration: 1, velocity: 88 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {
                'clip-b': [{ id: 'pb-b-1', value: 2000, beat: 1, channel: 0 }],
            },
        });
        addGainEnvelopePoint('clip-a', 1, -3);
        addWarpMarker('clip-b', 1, 1.5);
        clipSelectionStore.set({
            ...defaultClipSelectionState,
            selectedClipId: 'clip-a',
            selectedClipIds: ['clip-a', 'clip-b'],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        clipSelectionStore.set(defaultClipSelectionState);
        gainEnvelopeStore.set(defaultGainEnvelopeStoreState);
        warpStates.clear();
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('deletes two selected clips from one Delete keypress as one undo group, and one undo restores both clips with their MIDI data, satellites, and geometry', async () => {
        const prevent = handleKeydown(deleteKeyDescriptor());
        expect(prevent).toBe(true);

        // `deleteSelectionShortcut` fires the per-clip dispatches without
        // awaiting them, so the real kernel's completion is observed through
        // the state it owns: both clips gone and both history entries landed.
        await vi.waitFor(() => {
            expect(trackClips()).toEqual([]);
            expect(undoStore.value?.past).toHaveLength(2);
        });

        // One keypress, one undo group: both history entries share the
        // keyboard gesture's fresh `keyboard-delete-*` group id. The barrel's
        // `undoStore` read model freezes entries down to their label, so the
        // id is read through the history-capture use case instead.
        const capturedPast = captureUndoHistory().past;
        expect(capturedPast[0]?.groupId).toMatch(/^keyboard-delete-/u);
        expect(capturedPast[1]?.groupId).toBe(capturedPast[0]?.groupId);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual([]);
        expect(clipSelectionStore.value?.selectedClipId).toBeNull();

        // The clips' MIDI data and satellites retired with them, so the undo
        // assertions below cannot pass vacuously.
        expect(midiStore.value?.notesByClipId['clip-a']).toBeUndefined();
        expect(midiStore.value?.notesByClipId['clip-b']).toBeUndefined();
        expect(midiStore.value?.pitchBendByClipId['clip-b']).toBeUndefined();
        expect(gainEnvelopeStore.value?.envelopes['clip-a']).toBeUndefined();
        expect(warpStates.has('clip-b')).toBe(false);

        await undo();

        expect(notifications).toEqual([]);
        expect(
            trackClips()
                .map((clip) => clip.id)
                .sort()
        ).toEqual(['clip-a', 'clip-b']);
        // The ripple-aware inverse un-shifts clip-b back to its original span.
        // Store order after a grouped restore is an internal detail, so the
        // geometries are compared id-sorted rather than in array order.
        expect(
            trackClips()
                .map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }))
                .sort((alpha, beta) => alpha.id.localeCompare(beta.id))
        ).toEqual([
            { id: 'clip-a', startBeat: 0, endBeat: 4 },
            { id: 'clip-b', startBeat: 4, endBeat: 8 },
        ]);

        expect(midiStore.value?.notesByClipId['clip-a']).toEqual([
            { id: 'note-a-1', pitch: 60, startBeat: 0, duration: 2, velocity: 100 },
        ]);
        expect(midiStore.value?.notesByClipId['clip-b']).toEqual([
            { id: 'note-b-1', pitch: 64, startBeat: 0.5, duration: 1, velocity: 88 },
        ]);
        expect(midiStore.value?.pitchBendByClipId['clip-b']).toEqual([
            { id: 'pb-b-1', value: 2000, beat: 1, channel: 0 },
        ]);

        const restoredEnvelope = gainEnvelopeStore.value?.envelopes['clip-a'];
        expect(restoredEnvelope?.enabled).toBe(true);
        expect(
            restoredEnvelope?.points.map((point) => ({ beatOffset: point.beatOffset, gainDb: point.gainDb }))
        ).toEqual([
            { beatOffset: 0, gainDb: 0 },
            { beatOffset: 1, gainDb: -3 },
        ]);
        expect(warpStates.get('clip-b')?.markers).toEqual([
            expect.objectContaining({ originalBeat: 1, warpedBeat: 1.5 }),
        ]);

        // The whole gesture was one undo step: nothing left to undo, and both
        // inverses sit on the redo stack together.
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });
});

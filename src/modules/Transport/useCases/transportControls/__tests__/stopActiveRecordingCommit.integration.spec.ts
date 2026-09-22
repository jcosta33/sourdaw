import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, startRecording } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
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
import { transportStore } from '#/modules/Transport/stores';

import { stopActiveRecording } from '../stopActiveRecording';

const TRACK_ID = 'track-midi';

const mocks = vi.hoisted(() => ({
    stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}));

// The Arrangement handler graph imports this barrel too, so the real module is
// spread and only the audio flush is replaced for the stop path under test.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    stopAudioRecording: mocks.stopAudioRecording,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
function midiTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'MIDI',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
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
        midiFx: [],
    };
}

function clipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

function takeRefs(): { id: string; clipId: string }[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
        lane.takes.map((take) => ({ id: take.id, clipId: take.clipId }))
    );
}

/**
 * Issue #4439: the user-facing Stop must not resolve before the gesture's
 * history entry exists. A caller that awaits Stop and then presses Undo acts on
 * whatever heads the history, so a MIDI commit left in flight would let that
 * undo consume the previous entry instead of this recording's result.
 */
describe('stopActiveRecording commit ordering (issue #4439)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('stop active recording commit ordering');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [midiTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: true, playheadPosition: 8 });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('records the gesture entry before Stop resolves, so one undo removes the recorded result', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);

        // The user's Stop — not `stopRecording` directly.
        await stopActiveRecording();

        // No flush, no wait: awaiting Stop alone must guarantee the entry.
        const past = undoHistoryStore.value?.past ?? [];
        expect(past).toHaveLength(1);
        const entry = past[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected the recording commit entry on the history when Stop resolves');
        }
        expect(entry.action.type).toBe('commitRecording');

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);
    });
});

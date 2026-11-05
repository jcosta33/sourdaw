import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, getArrangementHandlers, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
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
import { midiStore } from '#/modules/MIDI/stores';

import { duplicateSelectedClipsForward } from '../duplicateSelectedClipsForward';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipsOn(trackId: string) {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

function copyOn(trackId: string, sourceId: string) {
    const copies = clipsOn(trackId).filter((clip) => clip.id !== sourceId);
    expect(copies).toHaveLength(1);
    return copies[0]!;
}

function notePitches(clipId: string): number[] {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => note.pitch);
}

function expectCopiesCarryTheirSource(midiCopyId: string, audioCopyId: string): void {
    // Selection span = latest end (8) - earliest start (0).
    expect(clipsOn('midi-track').find((clip) => clip.id === midiCopyId)).toMatchObject({
        type: 'midi',
        startBeat: 8,
        endBeat: 12,
        gain: 0.5,
    });
    expect(notePitches(midiCopyId)).toEqual([60, 64, 67]);
    expect(clipsOn('audio-track').find((clip) => clip.id === audioCopyId)).toMatchObject({
        type: 'audio',
        startBeat: 10,
        endBeat: 16,
        fadeInBeats: 1,
        fadeOutBeats: 2,
        audioOffsetBeats: 3,
        audioBufferId: 'audio-buffer',
    });
}

describe('duplicateSelectedClipsForward copies carry their content', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate forward content integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [
                createTrack({ id: 'midi-track', name: 'Keys', kind: 'midi' }),
                createTrack({ id: 'audio-track', name: 'Vox', kind: 'audio' }),
            ],
            selectedTrackId: 'midi-track',
        });
        addClip({
            id: 'midi-clip',
            trackId: 'midi-track',
            startBeat: 0,
            endBeat: 4,
            name: 'Chords',
            type: 'midi',
            gain: 0.5,
        });
        addClip({
            id: 'audio-clip',
            trackId: 'audio-track',
            startBeat: 2,
            endBeat: 8,
            name: 'Take',
            type: 'audio',
            audioBufferId: 'audio-buffer',
            fadeInBeats: 1,
            fadeOutBeats: 2,
            audioOffsetBeats: 3,
        });
        midiStore.set({
            notesByClipId: {
                'midi-clip': [
                    { id: 'note-c', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'note-e', pitch: 64, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'note-g', pitch: 67, startBeat: 2, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('copies each clip whole, removes every copy on one undo and restores them on one redo', async () => {
        await duplicateSelectedClipsForward(['midi-clip', 'audio-clip']);

        const midiCopy = copyOn('midi-track', 'midi-clip');
        const audioCopy = copyOn('audio-track', 'audio-clip');
        expectCopiesCarryTheirSource(midiCopy.id, audioCopy.id);

        await undo();
        expect(clipsOn('midi-track').map((clip) => clip.id)).toEqual(['midi-clip']);
        expect(clipsOn('audio-track').map((clip) => clip.id)).toEqual(['audio-clip']);
        expect(undoHistoryStore.value?.past).toEqual([]);

        await redo();
        expect(copyOn('midi-track', 'midi-clip').id).toBe(midiCopy.id);
        expect(copyOn('audio-track', 'audio-clip').id).toBe(audioCopy.id);
        expectCopiesCarryTheirSource(midiCopy.id, audioCopy.id);
    });
});

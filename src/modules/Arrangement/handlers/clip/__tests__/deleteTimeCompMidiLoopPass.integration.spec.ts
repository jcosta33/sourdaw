import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';
import { prepareTimelineMapStateRestore, prepareTimelineMapTimeOperation } from '#/modules/Transport/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Take, createTake, createTakeLane } from '../../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';

import type { automationStore } from '#/modules/Automation/stores';
import type { gainEnvelopeStore } from '../../../stores/gainEnvelopeStore';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: TrackStoreState;
    takeLanes: TakeLaneStoreState;
    midi: NonNullable<typeof midiStore.value>;
    automation: NonNullable<typeof automationStore.value>;
    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

function clips() {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

function notesOf(clipId: string): NonNullable<MidiStoreState['notesByClipId'][string]> {
    const notes = midiStore.value?.notesByClipId[clipId];
    if (!notes) {
        throw new Error(`Expected notes for clip ${clipId}`);
    }
    return notes;
}

/** Note rows without identity: pitch and media-coordinate start. */
function noteRows(groups: ReadonlyArray<ReadonlyArray<{ pitch: number; startBeat: number }>>): Array<[number, number]> {
    return groups.flatMap((group) => group.map((note) => [note.pitch, note.startBeat] as [number, number]));
}

/**
 * One loop-recorded MIDI clip over [8,16): the recording runs from beat 4
 * (run-up) through two full laps, every pass stored in the one clip's note
 * array one lap (8 beats) deeper than the last — pass 2 at media [8,16) — and
 * pass 2 comped across the whole clip span.
 */
function arrangeLoopCompMidi(): { compTake: Take } {
    const passLength = 8;
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'track-1',
        type: 'midi',
        startBeat: 8,
        endBeat: 16,
    });
    const passes = [
        createTake('source', 'Pass 1', 8, 16),
        createTake('source', 'Pass 2', 8, 16, passLength),
        createTake('source', 'Pass 3', 8, 16, passLength * 2),
    ];
    const compTake = passes[1]!;
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'midi', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                takes: passes,
                activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: compTake.id }],
            },
        ],
    });
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: {
            source: [
                { id: 'p1-a', pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 100 },
                { id: 'p1-b', pitch: 60, startBeat: 2.5, duration: 0.5, velocity: 100 },
                { id: 'p1-c', pitch: 60, startBeat: 4.5, duration: 0.5, velocity: 100 },
                { id: 'p2-a', pitch: 62, startBeat: 8.5, duration: 0.5, velocity: 100 },
                { id: 'p2-b', pitch: 62, startBeat: 10.5, duration: 0.5, velocity: 100 },
                { id: 'p2-c', pitch: 62, startBeat: 12.5, duration: 0.5, velocity: 100 },
                { id: 'p3-a', pitch: 64, startBeat: 16.5, duration: 0.5, velocity: 100 },
                { id: 'p3-b', pitch: 64, startBeat: 18.5, duration: 0.5, velocity: 100 },
                { id: 'p3-c', pitch: 64, startBeat: 20.5, duration: 0.5, velocity: 100 },
            ],
        },
    });
    flushAutomergeStorageWrites();
    return { compTake };
}

function expectAuthority(): void {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    expect(project?.tracks.tracks).toEqual(trackStore.value?.tracks);
    expect(project?.takeLanes.lanes).toEqual(takeLaneStore.value?.lanes);
    expect(project?.midi.notesByClipId).toEqual(midiStore.value?.notesByClipId);
}

/** Resolved comp fragments as plain rows: timeline span, media origin. */
function resolvedFragments(): number[][] {
    return resolveClipsWithComping('track-1', clips()).map((clip) => [
        clip.startBeat,
        clip.endBeat,
        clip.sourceStartBeat,
    ]);
}

/** The media window a resolved fragment enters its own clip's notes at. */
function fragmentMediaWindow(clipId: string): number[] {
    const fragment = resolveClipsWithComping('track-1', clips()).find((clip) => clip.id === clipId);
    if (!fragment) {
        throw new Error(`Expected a resolved fragment for clip ${clipId}`);
    }
    const midiOffset = fragment.midiOffsetBeats ?? 0;
    return [midiOffset, midiOffset + (fragment.endBeat - fragment.startBeat)];
}

describe('Delete Time through a comped MIDI loop pass (#5112)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('delete time comp midi loop pass integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('delete [10,12) leaves the left fragment playing pass 2 from 8 to 10', async () => {
        arrangeLoopCompMidi();

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 10, endBeat: 12 } });

        expect(undoStore.value?.past).toHaveLength(1);
        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the minted right fragment');
        }
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 10],
            [rightClip.id, 10, 14],
        ]);
        // The comp re-key rides with the delete: both fragments resolve their
        // pass-2 media — the left fragment enters the recording at its own
        // start (media origin 0), the right at the pass depth (media origin 2).
        expect(resolvedFragments()).toEqual([
            [8, 10, 0],
            [10, 14, 2],
        ]);
        // The issue's store check, inverted into the contract: the left
        // fragment holds the pass-2 notes its comp region plays (media [8,10))
        // next to the uncomped leftover before the cut, instead of only the
        // notes stored before the cut.
        expect(noteRows([notesOf('source')])).toEqual([
            [60, 0.5],
            [62, 8.5],
        ]);
        // And the right fragment holds pass-2's continuation inside the window
        // its region reads (media [12,16) rebased into [8,12)).
        const rightWindow = fragmentMediaWindow(rightClip.id);
        expect(rightWindow).toEqual([8, 12]);
        expect(
            noteRows([notesOf(rightClip.id)]).filter(
                ([pitch, start]) => pitch === 62 && start >= rightWindow[0]! && start < rightWindow[1]!
            )
        ).toEqual([[62, 8.5]]);
        expectAuthority();
    });

    it('delete ending inside the clip leaves the surviving left fragment its comped pass', async () => {
        arrangeLoopCompMidi();

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 12, endBeat: 20 } });

        expect(resolvedFragments()).toEqual([[8, 12, 0]]);
        // The surviving fragment's comp region reads media [8,12): pass 2's
        // notes for old timeline [8,12) must be on it.
        expect(
            noteRows([notesOf('source')]).filter(([pitch, start]) => pitch === 62 && start >= 8 && start < 12)
        ).toEqual([
            [62, 8.5],
            [62, 10.5],
        ]);
        expectAuthority();
    });

    it('undo restores the exact pre-delete notes and redo re-distributes them', async () => {
        arrangeLoopCompMidi();
        const originalNotes = structuredClone(notesOf('source'));

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 10, endBeat: 12 } });
        await undo();

        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 8, 16]]);
        expect(notesOf('source')).toEqual(originalNotes);
        expect(resolvedFragments()).toEqual([[8, 16, 0]]);
        expectAuthority();

        await redo();
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 10],
            [clips().find((clip) => clip.id !== 'source')!.id, 10, 14],
        ]);
        expect(
            noteRows([notesOf('source')]).filter(([pitch, start]) => pitch === 62 && start >= 8 && start < 10)
        ).toEqual([[62, 8.5]]);
        expectAuthority();
    });
});

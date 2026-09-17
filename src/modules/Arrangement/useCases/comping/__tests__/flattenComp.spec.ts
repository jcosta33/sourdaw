import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { automationStore } from '#/modules/Automation/stores';
import { undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { __resetGainEnvelopesForTest, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { restoreClipGlueState } from '../../clipEditing/restoreClipGlueState';
import { resolveClipsWithComping } from '../../resolveComping';
import { flattenComp } from '../flattenComp';

const notifyUserMock = vi.hoisted(() => vi.fn());

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

// The real transaction, kept observable: the refusal tests have to prove a
// guard fired BEFORE the clip replacement was attempted, which no store reading
// can show — the transaction refuses on the same input and leaves the same
// stores behind.
vi.mock('../../clipEditing/restoreClipGlueState', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../clipEditing/restoreClipGlueState')>();
    return { restoreClipGlueState: vi.fn(actual.restoreClipGlueState) };
});

const TRACK_ID = 'track-1';
const EMPTY_MIDI = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };

function seedTrack(clips: readonly Clip[], kind: 'audio' | 'midi' = 'audio'): void {
    const track = TrackDummy.create({ id: TRACK_ID, kind, clips: [...clips] });
    trackStore.set({ tracks: [track], selectedTrackId: TRACK_ID, ghostClips: [] });
}

function seedLane(
    takes: readonly { id: string; clipId: string; startBeat: number; endBeat: number }[],
    activeCompRegions: readonly { startBeat: number; endBeat: number; takeId: string }[]
): TakeLane {
    const lane: TakeLane = {
        ...createTakeLane(TRACK_ID),
        takes: takes.map((take) => ({ ...take, name: take.id, selected: false })),
        activeCompRegions: [...activeCompRegions],
    };
    takeLaneStore.set({ lanes: [lane] });
    return lane;
}

function liveClips(): Clip[] {
    return trackStore.value!.tracks[0]!.clips;
}

function laneIds(): string[] {
    return takeLaneStore.value!.lanes.map((lane) => lane.id);
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

const warnSpy = vi.spyOn(logger, 'warn');

function warnings(): string[] {
    return warnSpy.mock.calls.map((call) => String(call[0]));
}

describe('flattenComp', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(EMPTY_MIDI);
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
    });

    afterEach(() => {
        clearUndoHistory();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(EMPTY_MIDI);
        automationStore.set({ lanes: [] });
        __resetGainEnvelopesForTest();
    });

    it('leaves only the selected take’s material on the track', () => {
        // Two stacked recordings of the same bar; the comp selects the second
        // one over the whole span. Removing the lane alone left both clips on
        // the track, so the flattened track played take A and take B at once
        // (#3795).
        const takeAClip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-a',
        });
        const takeBClip = ClipDummy.create({
            id: 'clip-b',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-b',
        });
        seedTrack([takeAClip, takeBClip]);
        seedLane(
            [
                { id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 },
                { id: 'take-b', clipId: 'clip-b', startBeat: 0, endBeat: 8 },
            ],
            [{ startBeat: 0, endBeat: 8, takeId: 'take-b' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(true);

        expect(liveClips()).toHaveLength(1);
        expect(liveClips()[0]).toMatchObject({ audioBufferId: 'buf-b', startBeat: 0, endBeat: 8 });
        expect(liveClips()[0]!.audioOffsetBeats).toBeUndefined();
        expect(liveClips().some((clip) => clip.audioBufferId === 'buf-a')).toBe(false);
        // Fresh identity: the fragment is a new clip, not a re-used take id.
        expect(liveClips()[0]!.id).not.toBe('clip-b');
        expect(laneIds()).toEqual([]);

        // The programme the schedulers now see with no lane in the store is
        // the programme the comp played — which is the whole point of
        // flattening. (The offline/native mirror resolves the same fragment
        // set; its own spec pins that.)
        const programme = resolveClipsWithComping(TRACK_ID, liveClips());
        expect(programme.map((clip) => [clip.audioBufferId, clip.startBeat, clip.endBeat])).toEqual([['buf-b', 0, 8]]);
    });

    it('gives every fragment the media-entry offset its own position demands', () => {
        // One slipped recording with a comp region in the middle: the three
        // fragments the resolver plays enter the buffer 0.5, 2.5 and 4.5 beats
        // in. Materialising them with the clip's original 0.5 would replay the
        // same half-second three times.
        const sourceClip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-a',
            audioOffsetBeats: 0.5,
        });
        seedTrack([sourceClip]);
        seedLane(
            [{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(true);

        expect(liveClips().map((clip) => [clip.startBeat, clip.endBeat, clip.audioOffsetBeats])).toEqual([
            [0, 2, 0.5],
            [2, 4, 2.5],
            [4, 8, 4.5],
        ]);
        expect(new Set(liveClips().map((clip) => clip.id)).size).toBe(3);
        expect(liveClips().every((clip) => clip.audioBufferId === 'buf-a')).toBe(true);

        // What reaches the store is a `Clip`, not a resolver row: the resolver's
        // own region vocabulary is not part of the clip shape, and a clip
        // carrying it would be persisted, projected and diffed with fields no
        // consumer reads.
        for (const key of ['regionStartBeat', 'regionEndBeat', 'sourceStartBeat']) {
            expect(liveClips().filter((clip) => Object.hasOwn(clip, key))).toEqual([]);
        }
        const sourceKeys = new Set(Object.keys(sourceClip));
        for (const fragment of liveClips()) {
            expect(new Set(Object.keys(fragment))).toEqual(sourceKeys);
        }
    });

    it('copies each MIDI fragment’s notes under its own id and folds its offset', () => {
        seedTrack(
            [
                ClipDummy.create({ id: 'clip-a', trackId: TRACK_ID, type: 'midi', startBeat: 0, endBeat: 8 }),
                ClipDummy.create({
                    id: 'clip-b',
                    trackId: TRACK_ID,
                    type: 'midi',
                    startBeat: 0,
                    endBeat: 8,
                    midiOffsetBeats: 1,
                }),
            ],
            'midi'
        );
        midiStore.set({
            notesByClipId: {
                'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
                'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 3, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        seedLane(
            [
                { id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 },
                { id: 'take-b', clipId: 'clip-b', startBeat: 0, endBeat: 8 },
            ],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(true);

        const regionFragment = liveClips().find((clip) => clip.startBeat === 2)!;
        expect(regionFragment.endBeat).toBe(4);
        // The region starts two beats into the clip, so its notes must be read
        // two beats further into the clip's own frame.
        expect(regionFragment.midiOffsetBeats).toBe(3);
        expect(midiStore.value!.notesByClipId[regionFragment.id]).toMatchObject([
            { pitch: 64, startBeat: 3, duration: 1, velocity: 90 },
        ]);
        // A copy under a new identity: sharing the row id would make one edit
        // reach every fragment cut from the same take.
        expect(midiStore.value!.notesByClipId[regionFragment.id]![0]!.id).not.toBe('note-b');
        // The retired clip ids keep nothing behind.
        expect(Object.hasOwn(midiStore.value!.notesByClipId, 'clip-a')).toBe(false);
        expect(Object.hasOwn(midiStore.value!.notesByClipId, 'clip-b')).toBe(false);
        // The whole materialised programme: both takes still show through
        // outside the region, each fragment carrying its own folded offset and
        // its own copy of its take's notes.
        expect(
            liveClips().map((clip) => [
                clip.startBeat,
                clip.endBeat,
                clip.midiOffsetBeats,
                (midiStore.value!.notesByClipId[clip.id] ?? []).map((note) => note.pitch),
            ])
        ).toEqual([
            [0, 2, undefined, [60]],
            [0, 2, 1, [64]],
            [2, 4, 3, [64]],
            [4, 8, 4, [60]],
            [4, 8, 5, [64]],
        ]);
    });

    it('restores the clips, the MIDI rows and the lane under one undo entry', async () => {
        const takeAClip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
        });
        const takeBClip = ClipDummy.create({
            id: 'clip-b',
            trackId: TRACK_ID,
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
        });
        seedTrack([takeAClip, takeBClip], 'midi');
        midiStore.set({
            notesByClipId: {
                'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
                'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 3, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
            migratedAbsoluteNoteClipIds: ['clip-b'],
        });
        const lane = seedLane(
            [
                { id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 },
                { id: 'take-b', clipId: 'clip-b', startBeat: 0, endBeat: 8 },
            ],
            [{ startBeat: 0, endBeat: 8, takeId: 'take-b' }]
        );
        const originalClips = structuredClone(liveClips());
        const originalMidi = structuredClone(midiStore.value!);
        const depthBefore = undoDepth();

        expect(flattenComp(TRACK_ID)).toBe(true);
        const fragmentIds = liveClips().map((clip) => clip.id);
        expect(undoDepth()).toBe(depthBefore + 1);

        // A lane for another track, added after the flatten: undo must put the
        // flattened lane back without touching it (#4081).
        const siblingLane = createTakeLane('track-2');
        takeLaneStore.set({ lanes: [...takeLaneStore.value!.lanes, siblingLane] });

        await undo();
        expect(liveClips()).toEqual(originalClips);
        expect(midiStore.value).toEqual(originalMidi);
        expect(laneIds()).toEqual([lane.id, siblingLane.id]);

        await redo();
        expect(liveClips().map((clip) => clip.id)).toEqual(fragmentIds);
        expect(midiStore.value!.notesByClipId[fragmentIds[0]!]).toMatchObject([{ pitch: 64 }]);
        expect(laneIds()).toEqual([siblingLane.id]);
    });

    it('removes a lane that selects nothing and leaves the clips alone', () => {
        const clip = ClipDummy.create({ id: 'clip-a', trackId: TRACK_ID, startBeat: 0, endBeat: 8 });
        seedTrack([clip]);
        seedLane([{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }], []);
        const depthBefore = undoDepth();

        expect(flattenComp(TRACK_ID)).toBe(true);

        expect(laneIds()).toEqual([]);
        expect(liveClips()).toEqual([clip]);
        expect(undoDepth()).toBe(depthBefore + 1);
    });

    it('refuses a track with no take lane', () => {
        const clip = ClipDummy.create({ id: 'clip-a', trackId: TRACK_ID, startBeat: 0, endBeat: 8 });
        seedTrack([clip]);

        expect(flattenComp(TRACK_ID)).toBe(false);

        expect(liveClips()).toEqual([clip]);
        expect(undoDepth()).toBe(0);
    });

    it('refuses to flatten a clip carrying a gain envelope', () => {
        // The envelope is keyed by clip id, and the fragments are new ids: a
        // silent flatten would drop audible clip gain.
        const clip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-a',
        });
        seedTrack([clip]);
        const lane = seedLane(
            [{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }]
        );
        setEnvelope('clip-a', {
            clipId: 'clip-a',
            enabled: true,
            points: [{ id: 'point-1', beatOffset: 1, gainDb: -6 }],
        });

        expect(flattenComp(TRACK_ID)).toBe(false);

        // The satellite guard is what refused, before any clip was touched.
        // Stores alone cannot show that: with the guard gone the clip
        // transaction refuses the same input further down and leaves exactly
        // this state behind, so only the message and the untouched transaction
        // separate the two.
        expect(warnings()).toEqual([expect.stringContaining('gain envelope or warp state')]);
        expect(restoreClipGlueState).not.toHaveBeenCalled();
        expect(liveClips()).toEqual([clip]);
        expect(laneIds()).toEqual([lane.id]);
        expect(undoDepth()).toBe(0);
    });

    it('leaves the clips and the retired lane alone when the undo transaction is refused', async () => {
        const clip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-a',
        });
        seedTrack([clip]);
        seedLane(
            [{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(true);

        // One fragment moved after the flatten: the transaction no longer
        // recognises the clip set it is being asked to retire, so it refuses
        // and the originals cannot come back. The lane must not come back
        // either — its takes name clips the track would not hold.
        const fragments = liveClips();
        trackStore.set({
            tracks: [
                {
                    ...trackStore.value!.tracks[0]!,
                    clips: [{ ...fragments[0]!, startBeat: 1 }, ...fragments.slice(1)],
                },
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        const clipsBeforeUndo = structuredClone(liveClips());
        vi.clearAllMocks();

        const result = await undo();

        expect(liveClips()).toEqual(clipsBeforeUndo);
        expect(laneIds()).toEqual([]);
        expect(warnings()).toEqual([expect.stringContaining('undoing the flatten was refused')]);
        // The musician asked for this and nothing happened, so it has to be
        // said out loud rather than left in a developer log.
        expect(notifyUserMock.mock.calls).toEqual([
            ['Failed to undo flatten comp - the clips no longer match the flattened result', 'error'],
        ]);
        // An undo callback reports nothing back to `Command`, so the entry is
        // consumed either way and moves to `future`, leaving redo reachable
        // rather than wedging the stack. The refusal shows in the stores.
        expect(result.headConsumed).toBe(true);
        expect(undoStore.value!.past).toEqual([]);
        expect(undoStore.value!.future.map((entry) => entry.label)).toEqual(['Flatten comp']);
    });

    it('keeps the restored lane in place when the redo transaction is refused', async () => {
        const clip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buf-a',
        });
        seedTrack([clip]);
        const lane = seedLane(
            [{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(true);
        await undo();
        expect(liveClips()).toEqual([clip]);
        expect(laneIds()).toEqual([lane.id]);

        // The original clip trimmed after the undo: the redo's transaction no
        // longer matches the clip set it would retire. A lane added meanwhile
        // pins where the restored lane belongs.
        const siblingLane = createTakeLane('track-2');
        takeLaneStore.set({ lanes: [...takeLaneStore.value!.lanes, siblingLane] });
        trackStore.set({
            tracks: [{ ...trackStore.value!.tracks[0]!, clips: [{ ...clip, endBeat: 6 }] }],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        const clipsBeforeRedo = structuredClone(liveClips());
        vi.clearAllMocks();

        await redo();

        expect(liveClips()).toEqual(clipsBeforeRedo);
        expect(laneIds()).toEqual([lane.id, siblingLane.id]);
        expect(warnings()).toEqual([expect.stringContaining('redoing the flatten was refused')]);
        expect(notifyUserMock.mock.calls).toEqual([
            ['Failed to redo flatten comp - the clips no longer match the flattened state', 'error'],
        ]);
        // Reported not-applied: the entry leaves `future` and never reaches
        // `past`, so the entries behind it stay redoable instead of queueing
        // behind a forward path that can no longer run.
        expect(undoStore.value!.future).toEqual([]);
        expect(undoStore.value!.past).toEqual([]);
    });

    it('refuses to flatten a MIDI take whose probability roll depends on its clip id', () => {
        const clip = ClipDummy.create({
            id: 'clip-a',
            trackId: TRACK_ID,
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
        });
        seedTrack([clip], 'midi');
        midiStore.set({
            notesByClipId: {
                'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 100, probability: 50 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const originalMidi = structuredClone(midiStore.value!);
        const lane = seedLane(
            [{ id: 'take-a', clipId: 'clip-a', startBeat: 0, endBeat: 8 }],
            [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }]
        );

        expect(flattenComp(TRACK_ID)).toBe(false);

        expect(liveClips()).toEqual([clip]);
        expect(midiStore.value).toEqual(originalMidi);
        expect(laneIds()).toEqual([lane.id]);
        expect(undoDepth()).toBe(0);
    });
});

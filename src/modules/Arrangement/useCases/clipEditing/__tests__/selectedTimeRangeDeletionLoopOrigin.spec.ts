import { beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { setClipLoop } from '#/modules/Arrangement/useCases/clipLoop/setClipLoop';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import {
    getNotesForClip,
    prepareMidiGlobalTimeTransaction,
    projectMidiClipPlayback,
    setNotesForClip,
} from '#/modules/MIDI/useCases';
import { prepareTimelineMapTimeOperation, prepareTimelineMapStateRestore } from '#/modules/Transport/useCases';
import { resolveClipLoopOriginAdvance, resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { loopPhaseControllers, loopPhaseNotes, scoreMidiClips } from '../../../__tests__/midiClipScore';
import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { executeSelectedTimeRangeDeletion } from '../executeSelectedTimeRangeDeletion';

/**
 * #5198, the anchor's write law in the selected-range excise. A looping MIDI
 * clip's spanning fragment keeps the source's basis: it holds every row of the
 * source's loop, its content offset advances to the range end and it carries
 * the source's anchor, so it plays exactly what the source played from the
 * range end on. A MIDI clip that does not loop still re-bases its fragment's
 * notes under `midiOffsetBeats` 0. An excised head is a start trim in place:
 * the clip keeps its id and notes, its content offset advances by the trimmed
 * span, and a looping clip keeps the source's loop length and anchor, so what
 * follows the range plays exactly where, and as, the uncut clip played it.
 *
 * The audio twins follow the same per-basis law on the other side: an audio
 * fragment's `audioOffsetBeats` stays in source coordinates, advanced by the
 * stretched media delta the cut consumed, so its anchor shifts by
 * `timelineDelta - contentDelta` — zero at stretch 1 — and the fragment's
 * advance grows by exactly the offset's growth: the region the audio readers
 * recover, `audioOffsetBeats - (startBeat - loopOriginBeat)`, stays the
 * source's own at any ratio, and the entry lands at the cut phase. Carried
 * unshifted, a stretched cut displaces the region by
 * `timelineDelta * (stretch - 1)` source beats — the stretched pins below.
 *
 * Each case drives the real transaction (real MIDI split, real arrangement
 * write) and reads what the survivors play through `projectMidiClipPlayback`.
 */

// The MIDI restore dependency has no real export outside its own module; the
// transaction under test never reaches it, so it gets the inert prepared shape.
const prepareMidiTimeStateRestore = () => ({
    status: 'ready' as const,
    hasChanges: false,
    apply: () => true,
    revert: () => true,
});

const LOOP_LENGTH = 4;

setTimeOperationDependencies({
    savedRestorePlanValidators: { automation: () => false, midi: () => false, timelineMap: () => false },
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
    prepareTimelineMapTimeOperation,
    prepareTimelineMapStateRestore,
});

function loopedClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'c-loop',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        audioOffsetBeats: 0,
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: 4,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function midiTrack(clips: Clip[]): Track {
    return {
        id: 't-keys',
        name: 'Keys',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '',
        clips,
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
        activeAlternativeId: 'alt-keys',
        alternatives: [{ id: 'alt-keys', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function audioLoopedClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'c-loop',
        startBeat: 0,
        endBeat: 16,
        type: 'audio',
        audioBufferId: 'buf-loop',
        audioOffsetBeats: 0,
        loopEnabled: true,
        loopLength: LOOP_LENGTH,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function audioTrack(clips: Clip[]): Track {
    return {
        ...midiTrack(clips),
        kind: 'audio',
    };
}

/**
 * The loop phrase on one looping MIDI clip, anchored at beat 0 unless the
 * overrides say otherwise. An override of `undefined` drops the key, the way
 * the CRDT normalizer stores an absent optional field.
 */
function seedLoopPhrase(clipOverrides: Partial<Clip>): void {
    const clip: Clip = loopedClip({ loopOriginBeat: 0, ...clipOverrides });
    for (const key of ['loopLength', 'loopOriginBeat'] as const) {
        if (clip[key] === undefined) {
            delete clip[key];
        }
    }
    midiStore.set({
        ...defaultMidiStoreState,
        notesByClipId: { 'c-loop': loopPhaseNotes() },
        ccByClipId: { 'c-loop': loopPhaseControllers() },
        pitchBendByClipId: {},
    });
    trackStore.set({ ...defaultTrackState, tracks: [midiTrack([clip])] });
}

function seedLoopedClip(notes: Array<{ id: string; startBeat: number }>): void {
    midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip()])] });
    // Loop established at the clip's placement: the anchor a real user gesture
    // (setClipLoop) stamps.
    expect(setClipLoop('c-loop', true)).toBe(true);
    setNotesForClip(
        'c-loop',
        notes.map((note) => ({ id: note.id, pitch: 60, startBeat: note.startBeat, duration: 0.5, velocity: 100 }))
    );
}

function allClips(): Clip[] {
    return trackStore.value?.tracks.flatMap((track) => track.clips) ?? [];
}

function seedAudioLoopedClip(clipOverrides: Partial<Clip> = {}): void {
    trackStore.set({ ...defaultTrackState, tracks: [audioTrack([audioLoopedClip(clipOverrides)])] });
    // Loop established at the clip's placement: the anchor a real user gesture
    // (setClipLoop) stamps.
    expect(setClipLoop('c-loop', true)).toBe(true);
}

function projectSoundingStartBeats(clip: Clip): number[] {
    return projectMidiClipPlayback({
        notes: getNotesForClip(clip.id),
        controlChanges: [],
        clip,
    })
        .notes.map((note) => note.startBeat)
        .toSorted((left, right) => left - right);
}

/**
 * The geometry every audio loop reader recovers per pass (`scheduleAudioClips`,
 * `projectOfflineAudioClipPlaybacks`): the region the clip was looped with,
 * `audioOffsetBeats - (startBeat - loopOriginBeat)`, and the phase the pass
 * enters it at, `advance % loopLength`.
 */
function regionOf(clip: Clip): { region: number; entry: number } {
    const advance = resolveClipLoopOriginAdvance({
        startBeat: clip.startBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return {
        region: (clip.audioOffsetBeats ?? 0) - advance,
        entry: ((advance % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH,
    };
}

describe('selected-range excise keeps looped survivors sounding (#5198)', () => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it.each([
        { name: 'an off-grid spanning excise', clip: {}, range: { startBeat: 2, endBeat: 7 } },
        {
            name: 'a spanning excise through a start-trimmed clip anchored before its start',
            clip: { startBeat: 3, endBeat: 19, midiOffsetBeats: 2, loopOriginBeat: 1 },
            range: { startBeat: 5.5, endBeat: 9 },
        },
        {
            name: 'a spanning excise through a clip the loop gesture never anchored',
            clip: { loopOriginBeat: undefined },
            range: { startBeat: 4, endBeat: 8 },
        },
    ])('$name keeps every beat the looping MIDI clip still plays', ({ clip, range }) => {
        // The spanning fragment used to re-base its notes to 0 and restamp the
        // anchor at its own head (#5495), so it restarted the loop at the
        // range end: an excise ending at 7 on a loop-4 clip struck n-a where
        // the source struck n-c.
        seedLoopPhrase(clip);
        const source = structuredClone(allClips()[0]);
        if (!source) {
            throw new Error('Expected the seeded clip');
        }
        const headEnd = Math.max(source.startBeat, range.startBeat);
        const tailStart = Math.min(source.endBeat, range.endBeat);
        const expected = [
            ...scoreMidiClips([source], source.startBeat, headEnd),
            ...scoreMidiClips([source], tailStart, source.endBeat),
        ];

        const result = executeSelectedTimeRangeDeletion({ ...range, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const survivors = allClips();
        expect([
            ...scoreMidiClips(survivors, source.startBeat, headEnd),
            ...scoreMidiClips(survivors, tailStart, source.endBeat),
        ]).toEqual(expected);
        expect(scoreMidiClips(survivors, headEnd, tailStart).flatMap((beat) => beat.sounding)).toEqual([]);
    });

    it('keeps re-basing the fragment of a MIDI clip that does not loop, without an anchor key', () => {
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: { 'c-loop': [{ id: 'n-a', pitch: 60, startBeat: 8.5, duration: 0.5, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const plain = loopedClip({ loopEnabled: false });
        delete plain.loopLength;
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([plain])] });

        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const fragment = allClips().find((clip) => clip.id.startsWith('clip-dtr-'));
        if (!fragment) {
            throw new Error('Expected the excise right fragment in the track store');
        }
        expect(fragment.midiOffsetBeats).toBe(0);
        expect(Object.hasOwn(fragment, 'loopOriginBeat')).toBe(false);
        expect(midiStore.value?.notesByClipId[fragment.id]?.map((note) => note.startBeat)).toEqual([0.5]);
    });

    it('the head excise trims the clip in place: its surviving notes sound where the uncut clip played them', () => {
        // Excise [0,2) over the looped clip [0,16): the clip keeps its id and
        // notes, its head moves to 2 and its content offset advances by the
        // same 2, so content after the range stays where it was. n-a/n-b
        // (m 2.5, 3.5) strike on every pass of the uncut clip after beat 2;
        // n-c (m 4.5) sits past the loop region and stays silent. Relocating
        // the clip instead (offset kept, anchor carried to 2) played every
        // survivor two beats late.
        seedLoopedClip([
            { id: 'n-a', startBeat: 2.5 },
            { id: 'n-b', startBeat: 3.5 },
            { id: 'n-c', startBeat: 4.5 },
        ]);
        const uncut = structuredClone(allClips()[0]);
        if (!uncut) {
            throw new Error('Expected the seeded clip');
        }
        const uncutAfterRange = projectSoundingStartBeats(uncut).filter((beat) => beat >= 2);
        expect(uncutAfterRange).toEqual([2.5, 3.5, 6.5, 7.5, 10.5, 11.5, 14.5, 15.5]);

        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 2, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const trimmed = allClips().find((clip) => clip.id === 'c-loop');
        if (!trimmed) {
            throw new Error('Expected the head-excised clip to keep its id');
        }
        expect(trimmed).toMatchObject({ startBeat: 2, midiOffsetBeats: 2, loopLength: 4, loopOriginBeat: 0 });
        expect(projectSoundingStartBeats(trimmed)).toEqual(uncutAfterRange);
    });

    it.each([
        { name: 'an off-grid head excise', clip: {}, range: { startBeat: 0, endBeat: 5 } },
        {
            name: 'a head excise through a start-trimmed clip anchored before its start',
            clip: { startBeat: 3, endBeat: 19, midiOffsetBeats: 2, loopOriginBeat: 1 },
            range: { startBeat: 1, endBeat: 10.5 },
        },
        {
            name: 'a head excise through a clip the loop gesture never anchored',
            clip: { loopOriginBeat: undefined },
            range: { startBeat: 0, endBeat: 6 },
        },
        {
            name: 'a head excise through a clip that loops its own length',
            clip: { endBeat: 6, loopLength: undefined },
            range: { startBeat: 0, endBeat: 1 },
        },
    ])('$name keeps every beat the looping MIDI clip still plays after the range', ({ clip, range }) => {
        seedLoopPhrase(clip);
        const source = structuredClone(allClips()[0]);
        if (!source) {
            throw new Error('Expected the seeded clip');
        }
        const expected = scoreMidiClips([source], range.endBeat, source.endBeat);
        // The fixture is not vacuous: the surviving span strikes several notes.
        expect(expected.filter((beat) => beat.struck.length > 0).length).toBeGreaterThan(2);

        const result = executeSelectedTimeRangeDeletion({ ...range, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const survivors = allClips();
        expect(survivors.map((survivor) => [survivor.id, survivor.startBeat])).toEqual([['c-loop', range.endBeat]]);
        expect(scoreMidiClips(survivors, range.endBeat, source.endBeat)).toEqual(expected);
        expect(scoreMidiClips(survivors, 0, range.endBeat).flatMap((beat) => beat.struck)).toEqual([]);
        // The probability roll counts passes from the loop anchor; the trimmed
        // clip keeps the source's, so every pass rolls as the uncut clip's did.
        const anchoredStartOf = (candidate: Clip) =>
            resolveLoopAnchoredStartBeat({
                startBeat: candidate.startBeat,
                loopOriginBeat: candidate.loopOriginBeat,
                loopEnabled: candidate.loopEnabled ?? false,
            });
        expect(anchoredStartOf(survivors[0]!)).toBe(anchoredStartOf(source));
    });

    it('the spanning audio fragment carries its anchor and keeps the source region', () => {
        // Audio clip [0,16) anchored at 0, region [0,4). Excise [4,8)
        // advances the fragment's offset to 8 — the content the source played
        // at the range end — with its head at 8, the same preserved media
        // basis the split's audio fragment keeps: the anchor carries, the
        // advance grows by the consumed span, and region 8 − 8 = 0 at entry
        // phase 0 is the source's own. The type-blind restamp would have read
        // offset 8 outright.
        seedAudioLoopedClip();

        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const fragment = allClips().find((clip) => clip.id.startsWith('clip-dtr-'));
        if (!fragment) {
            throw new Error('Expected the excise right fragment in the track store');
        }
        expect(fragment.startBeat).toBe(8);
        expect(fragment.audioOffsetBeats).toBe(8);
        expect(fragment.loopOriginBeat).toBe(0);
        expect(regionOf(fragment)).toEqual({ region: 0, entry: 0 });

        // The kept left half preserves the source basis, so the region the
        // fragment reads is still the source's own.
        const kept = allClips().find((clip) => clip.id === 'c-loop');
        if (!kept) {
            throw new Error('Expected the left fragment to keep the source id');
        }
        expect(regionOf(fragment)).toEqual(regionOf(kept));
    });

    it('the head-excised audio fragment carries its anchor: the region stays pinned at the cut phase', () => {
        // Audio clip [0,16) anchored at 0, region [0,4). Excise [0,5) keeps
        // the clip's id and advances its offset by the span to 5. The carried
        // anchor lets the advance grow by the same span: region 5 − 5 = 0 with
        // the entry at phase 5 mod 4 = 1, the cut phase. A relocation shift of
        // the anchor would pin the advance at 0 and slide the region to 5 — the
        // fragment reading source beats 5-6 outside the region — the #5198
        // review draw.
        seedAudioLoopedClip();

        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 5, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const trimmed = allClips().find((clip) => clip.id === 'c-loop');
        if (!trimmed) {
            throw new Error('Expected the head-excised clip to keep its id');
        }
        expect(trimmed.startBeat).toBe(5);
        expect(trimmed.audioOffsetBeats).toBe(5);
        expect(trimmed.loopOriginBeat).toBe(0);
        expect(regionOf(trimmed)).toEqual({ region: 0, entry: 1 });
    });

    it('a stretched spanning excise shifts the fragment anchor by the stretch residue', () => {
        // Audio clip [0,16) anchored at 0, region [0,4), ratio 2. Excise
        // [4,8): the fragment's offset advances by the stretched media delta,
        // 8 × 2 = 16 — the content the runtimes actually played over the cut —
        // with its head at 8. The anchor therefore shifts by
        // 8 − 16 = −8: advance 8 − (−8) = 16 recovers region 16 − 16 = 0 at
        // entry phase 0, the source's own. Carried unshifted, the advance
        // would grow by the raw span only (8) and the region would read 8 —
        // displaced by exactly 8 × (2 − 1) source beats.
        seedAudioLoopedClip({ stretchMode: 'timestretch', stretchRatio: 2 });

        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const fragment = allClips().find((clip) => clip.id.startsWith('clip-dtr-'));
        if (!fragment) {
            throw new Error('Expected the excise right fragment in the track store');
        }
        expect(fragment.startBeat).toBe(8);
        expect(fragment.audioOffsetBeats).toBe(16);
        expect(fragment.loopOriginBeat).toBe(-8);
        expect(regionOf(fragment)).toEqual({ region: 0, entry: 0 });
    });

    it('a stretched head excision shifts the trimmed anchor by the stretch residue', () => {
        // Audio clip [0,16) anchored at 0, region [0,4), ratio 2. Excise
        // [0,6): the clip keeps its id, its head moves to 6, and its offset
        // advances by the stretched media delta 6 × 2 = 12. The anchor shifts
        // by 6 − 12 = −6: advance 6 − (−6) = 12 recovers region 12 − 12 = 0
        // at entry phase 12 mod 4 = 0. Carried unshifted, the region would
        // read 12 − 6 = 6 — material past the region end that never sounds.
        seedAudioLoopedClip({ stretchMode: 'timestretch', stretchRatio: 2 });

        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 6, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const trimmed = allClips().find((clip) => clip.id === 'c-loop');
        if (!trimmed) {
            throw new Error('Expected the head-excised clip to keep its id');
        }
        expect(trimmed.startBeat).toBe(6);
        expect(trimmed.audioOffsetBeats).toBe(12);
        expect(trimmed.loopOriginBeat).toBe(-6);
        expect(regionOf(trimmed)).toEqual({ region: 0, entry: 0 });
    });
});

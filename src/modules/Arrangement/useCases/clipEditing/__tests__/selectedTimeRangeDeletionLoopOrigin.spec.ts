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
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';

import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { executeSelectedTimeRangeDeletion } from '../executeSelectedTimeRangeDeletion';

/**
 * #5198, the anchor's write law in the selected-range excise. The spanning
 * fragment re-bases its notes by −splitBeat under `midiOffsetBeats` 0 and
 * moves its head to the range end — a fresh coordinate basis, so the writer
 * re-stamps the anchor to the fragment's own start. The right-edge trim keeps
 * the clip's id, notes, and content offset — a whole-clip relocation — so the
 * anchor rides the placement delta. Carried through, the stale anchor silenced
 * every surviving note of an excised head (the #5198 review draw).
 *
 * The audio twins follow the same per-basis law on the other side: an audio
 * fragment's `audioOffsetBeats` stays in source coordinates advanced by the
 * cut, so it carries the source anchor — the offset advance and the
 * anchor-advance growth cancel, the region the audio readers recover,
 * `audioOffsetBeats - (startBeat - loopOriginBeat)`, stays the source's own,
 * and the entry lands at the cut phase.
 *
 * Each case drives the real transaction (real MIDI split, real arrangement
 * write) and reads the survivor back through `projectMidiClipPlayback`.
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

    it('the spanning fragment re-stamps the anchor to its head and keeps sounding its surviving notes', () => {
        // Excise [4,8) over the looped clip [0,16): n-a/n-b/n-c (m 8.5, 10,
        // 12.5) move to the right fragment re-based by −8, landing at 0.5, 2
        // and 4.5.
        seedLoopedClip([
            { id: 'n-a', startBeat: 8.5 },
            { id: 'n-b', startBeat: 10 },
            { id: 'n-c', startBeat: 12.5 },
        ]);

        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const fragment = allClips().find((clip) => clip.id.startsWith('clip-dtr-'));
        if (!fragment) {
            throw new Error('Expected the excise right fragment in the track store');
        }
        expect(fragment.startBeat).toBe(8);
        expect(fragment.midiOffsetBeats).toBe(0);
        // Re-stamped to the fragment's own head: advance zero, the window
        // opening where the surviving material starts. The stale carry would
        // derive advance 8, whose window [−8,−4) silences every survivor.
        expect(fragment.loopOriginBeat).toBe(8);

        const sounded = projectSoundingStartBeats(fragment);
        expect(sounded).toEqual([8.5, 10, 12.5, 14]);
        expect(sounded).toEqual(projectSoundingStartBeats({ ...fragment, loopOriginBeat: undefined }));
    });

    it('the right-edge trim rides the anchor with its relocation and keeps sounding its surviving notes', () => {
        // Excise [0,2) over the looped clip [0,16): the trim keeps the clip's
        // id, notes, and content offset and moves the head to 2 — a whole-clip
        // relocation by 2, so the anchor rides to 2 and the advance stays 0.
        // n-a/n-b (m 2.5, 3.5) sound before and survive; n-c (m 4.5) sits past
        // the window and stays silent.
        seedLoopedClip([
            { id: 'n-a', startBeat: 2.5 },
            { id: 'n-b', startBeat: 3.5 },
            { id: 'n-c', startBeat: 4.5 },
        ]);

        const result = executeSelectedTimeRangeDeletion({ startBeat: 0, endBeat: 2, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const trimmed = allClips().find((clip) => clip.id === 'c-loop');
        if (!trimmed) {
            throw new Error('Expected the right-edge clip to keep its id');
        }
        expect(trimmed.startBeat).toBe(2);
        expect(trimmed.loopOriginBeat).toBe(2);

        // The stale carry would derive advance 2, whose window [−2,2)
        // silences every survivor — the #5198 draw.
        const sounded = projectSoundingStartBeats(trimmed);
        expect(sounded).toEqual([4.5, 5.5, 8.5, 9.5, 12.5, 13.5]);
        expect(sounded).toEqual(projectSoundingStartBeats({ ...trimmed, loopOriginBeat: undefined }));
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
        // the entry at phase 5 mod 4 = 1, the cut phase. The relocation shift
        // the MIDI side takes here would pin the advance at 0 and slide the
        // region to 5 — the fragment reading source beats 5-6 outside the
        // region — the #5198 review draw.
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

    it('an unanchored clip writes no anchor key on its fragment', () => {
        // The entry-helper law: the key is written only when an anchor exists,
        // so a legacy clip the loop field never stamped stays key-absent — the
        // inverse plan compares clip snapshots structurally. The fixture is
        // loop-enabled but carries no loopOriginBeat and setClipLoop never
        // stamps one.
        midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip()])] });
        setNotesForClip('c-loop', [{ id: 'n-a', pitch: 60, startBeat: 8.5, duration: 0.5, velocity: 100 }]);
        const seeded = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        if (!seeded) {
            throw new Error('Expected the seeded clip');
        }
        expect(Object.hasOwn(seeded, 'loopOriginBeat')).toBe(false);

        const result = executeSelectedTimeRangeDeletion({ startBeat: 4, endBeat: 8, trackIds: ['t-keys'] });
        expect(result.status).toBe('applied');

        const fragment = allClips().find((clip) => clip.id.startsWith('clip-dtr-'));
        if (!fragment) {
            throw new Error('Expected the excise right fragment in the track store');
        }
        expect(Object.hasOwn(fragment, 'loopOriginBeat')).toBe(false);
    });
});

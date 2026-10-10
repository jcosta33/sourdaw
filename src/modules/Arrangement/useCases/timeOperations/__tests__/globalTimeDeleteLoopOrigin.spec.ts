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

import { executeGlobalTimeOperation } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

/**
 * #5198, the fragment half of the anchor's write law in the global time
 * delete. A delete's surviving right fragment re-bases its notes by −splitBeat
 * under `midiOffsetBeats` 0 and moves its head — a fresh coordinate basis the
 * source anchor has no meaning in, so the writer re-stamps the anchor to the
 * fragment's own start (advance zero, the window opening at the head, the
 * pre-anchor admission) and an unanchored source keeps the key absent. Carried
 * through, the stale anchor derived a spurious advance whose window silenced
 * the fragment's surviving material — the #5198 review draw: Delete Time
 * [4,8) over a looped clip [0,16) left the fragment projecting 0 notes where
 * the anchor-free state projects 4.
 *
 * The audio twin follows the same per-basis law on the other side: its
 * `audioOffsetBeats` stays in source coordinates, advanced by the consumed
 * span, while its head rides the compressing relocation by −duration — so it
 * carries the source anchor through the cut and rides that relocation, and the
 * region the audio readers recover,
 * `audioOffsetBeats - (startBeat - loopOriginBeat)`, stays the source's own
 * with the entry landing at the cut phase.
 *
 * Each case drives the real transaction (real MIDI split, real arrangement
 * write) and reads the fragment back through `projectMidiClipPlayback`, the
 * projection the note scheduler draws from.
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

function audioTrack(clips: Clip[]): Track {
    return {
        ...midiTrack(clips),
        kind: 'audio',
    };
}

function seedLoopedClip(notes: Array<{ id: string; startBeat: number }>, clipOverrides: Partial<Clip> = {}): void {
    midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip(clipOverrides)])] });
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

function requireRightFragment(): Clip {
    const fragment = allClips().find((clip) => clip.id.startsWith('clip-dt-'));
    if (!fragment) {
        throw new Error('Expected the delete-right fragment in the track store');
    }
    return fragment;
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

describe('global time delete keeps a looped fragment sounding (#5198)', () => {
    beforeEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
        midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('a spanning fragment re-stamps the anchor to its head and keeps sounding its surviving notes', () => {
        // Anchored window [0,4): n-left sounds and stays in the left half;
        // n-a/n-b/n-c sit past the deleted [4,8) and move to the fragment
        // re-based by −8, landing at 0.5, 2 and 4.5.
        seedLoopedClip([
            { id: 'n-left', startBeat: 1 },
            { id: 'n-a', startBeat: 8.5 },
            { id: 'n-b', startBeat: 10 },
            { id: 'n-c', startBeat: 12.5 },
        ]);

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');

        const fragment = requireRightFragment();
        expect(fragment.startBeat).toBe(4);
        expect(fragment.midiOffsetBeats).toBe(0);
        // Re-stamped to the fragment's own head: advance zero, the window
        // opening where the surviving material starts.
        expect(fragment.loopOriginBeat).toBe(4);

        // The surviving head material sounds across both passes — the
        // anchor-free projection of this exact state — and the note past the
        // re-stamped window stays silent.
        const sounded = projectSoundingStartBeats(fragment);
        expect(sounded).toEqual([4.5, 6, 8.5, 10]);
        expect(sounded).toEqual(projectSoundingStartBeats({ ...fragment, loopOriginBeat: undefined }));

        // The left half keeps its id and anchor; its in-window note still
        // sounds exactly as before the edit.
        const left = allClips().find((clip) => clip.id === 'c-loop');
        if (!left) {
            throw new Error('Expected the left fragment to keep the source id');
        }
        expect(left.loopOriginBeat).toBe(0);
        expect(projectSoundingStartBeats(left)).toEqual([1]);
    });

    it('a right-edge fragment re-stamps the anchor and keeps sounding its surviving notes', () => {
        // Clip [6,20) anchored at 6, window [0,4) covering timeline [6,10).
        // Delete [4,8) excises the head m∈[0,2): n-a/n-b (m 2.5, 3.5) sound
        // before and survive onto the fragment at 0.5/1.5; n-c (m 6.5) lands
        // past the re-stamped window. Note starts are clip-relative, hence the
        // timeline positions minus the 6-beat head.
        seedLoopedClip(
            [
                { id: 'n-a', startBeat: 2.5 },
                { id: 'n-b', startBeat: 3.5 },
                { id: 'n-c', startBeat: 6.5 },
            ],
            { startBeat: 6, endBeat: 20 }
        );

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');

        const fragment = requireRightFragment();
        expect(fragment.startBeat).toBe(4);
        expect(fragment.midiOffsetBeats).toBe(0);
        expect(fragment.loopOriginBeat).toBe(4);

        // The stale carry would derive a negative advance (4 − 6) whose window
        // [2,6) drops the surviving head material and admits n-c instead.
        const sounded = projectSoundingStartBeats(fragment);
        expect(sounded).toEqual([4.5, 5.5, 8.5, 9.5, 12.5, 13.5]);
        expect(sounded).toEqual(projectSoundingStartBeats({ ...fragment, loopOriginBeat: undefined }));
    });

    it('the audio survivor carries its anchor through the cut, rides the relocation, and keeps the source region', () => {
        // Audio clip [0,16) anchored at 0, region [0,4). Delete [4,8)
        // advances the fragment's offset to 8 — the content the source played
        // at the range end — while its head rides the compressing relocation
        // to 4. The anchor carries through the cut and rides that relocation
        // (0 → −4), so the advance grows by the consumed span: region
        // 8 − 8 = 0, entry phase 0 — the source's own region and cycle phase,
        // reading buffer beat 0. The type-blind restamp read offset 8
        // outright, and a bare carry without the relocation would read 4.
        seedAudioLoopedClip();

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');

        const fragment = requireRightFragment();
        expect(fragment.type).toBe('audio');
        expect(fragment.startBeat).toBe(4);
        expect(fragment.endBeat).toBe(12);
        expect(fragment.audioOffsetBeats).toBe(8);
        expect(fragment.loopOriginBeat).toBe(-4);
        expect(regionOf(fragment)).toEqual({ region: 0, entry: 0 });

        // The kept left half preserves the source basis, so the region the
        // survivor reads is still the source's own.
        const kept = allClips().find((clip) => clip.id === 'c-loop');
        if (!kept) {
            throw new Error('Expected the left fragment to keep the source id');
        }
        expect(regionOf(fragment)).toEqual(regionOf(kept));
    });

    it('an unanchored clip writes no anchor key on its fragment', () => {
        // The entry-helper law: the key is written only when an anchor exists,
        // so a legacy clip the loop field never stamped stays key-absent — the
        // inverse plan compares clip snapshots structurally. The fixture below
        // is loop-enabled but carries no loopOriginBeat and setClipLoop never
        // stamps one.
        midiStore.set({ ...defaultMidiStoreState, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        trackStore.set({ ...defaultTrackState, tracks: [midiTrack([loopedClip()])] });
        setNotesForClip('c-loop', [{ id: 'n-a', pitch: 60, startBeat: 8.5, duration: 0.5, velocity: 100 }]);
        const seeded = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        if (!seeded) {
            throw new Error('Expected the seeded clip');
        }
        expect(Object.hasOwn(seeded, 'loopOriginBeat')).toBe(false);

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');

        const fragment = requireRightFragment();
        expect(Object.hasOwn(fragment, 'loopOriginBeat')).toBe(false);
    });
});

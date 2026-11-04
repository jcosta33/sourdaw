import { beforeEach, describe, expect, it } from 'vitest';

import { type Clip, type Track, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { setClipLoop } from '#/modules/Arrangement/useCases/clipLoop/setClipLoop';
import { prepareAutomationTimeOperation, prepareAutomationTimeStateRestore } from '#/modules/Automation/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';
import { prepareTimelineMapTimeOperation, prepareTimelineMapStateRestore } from '#/modules/Transport/useCases';
import { resolveClipLoopOriginAdvance, resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { loopPhaseControllers, loopPhaseNotes, scoreMidiClips, shiftScore } from '../../../__tests__/midiClipScore';
import { executeGlobalTimeOperation } from '../executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

/**
 * #5198, the fragment half of the anchor's write law in the global time
 * delete. A looping MIDI survivor keeps the source's basis: it holds every row
 * of the source's loop, its content offset advances by what the delete
 * consumed, and its anchor rides the compressing relocation, so every beat it
 * plays is a beat the source played, moved left by the deleted span. A MIDI
 * clip that does not loop still re-bases its survivor's notes under
 * `midiOffsetBeats` 0 and leaves the anchor key absent.
 *
 * The audio twin follows the same law: its `audioOffsetBeats` stays in source
 * coordinates, advanced by the consumed span, while its head rides the
 * compressing relocation by −duration — so it carries the source anchor
 * through the cut and rides that relocation, and the region the audio readers
 * recover, `audioOffsetBeats - (startBeat - loopOriginBeat)`, stays the
 * source's own with the entry landing at the cut phase.
 *
 * Each case drives the real transaction (real MIDI split, real arrangement
 * write) and reads what the clips play through `projectMidiClipPlayback`, the
 * projection the note and controller schedulers draw from.
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

function requireClip(clipId: string): Clip {
    const clip = allClips().find((candidate) => candidate.id === clipId);
    if (!clip) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return structuredClone(clip);
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

    it.each([
        {
            name: 'a spanning delete with an off-grid start',
            clip: {},
            range: { startBeat: 2, endBeat: 7 },
        },
        {
            name: 'a spanning delete through a start-trimmed clip anchored before its start',
            clip: { startBeat: 3, endBeat: 19, midiOffsetBeats: 2, loopOriginBeat: 1 },
            range: { startBeat: 5.5, endBeat: 9 },
        },
        {
            name: 'a spanning delete through a whole-length loop',
            clip: { endBeat: 12, loopLength: undefined },
            range: { startBeat: 2.5, endBeat: 5 },
        },
        {
            name: 'a delete that consumes the head of a clip anchored at its start',
            clip: { startBeat: 3, endBeat: 19, loopOriginBeat: 3 },
            range: { startBeat: 1, endBeat: 6 },
        },
        {
            name: 'a spanning delete through a clip the loop gesture never anchored',
            clip: { loopOriginBeat: undefined },
            range: { startBeat: 4, endBeat: 8 },
        },
        {
            name: 'a delete that consumes the tail',
            clip: { endBeat: 10 },
            range: { startBeat: 6.5, endBeat: 12 },
        },
    ])('$name keeps every beat the looping MIDI clip plays', ({ clip, range }) => {
        // The survivor used to re-base its notes to 0 and restamp the anchor
        // at its own head (#5495), so it restarted the loop at the cut: a
        // delete ending at 7 on a loop-4 clip struck n-a where the source
        // struck n-c.
        seedLoopPhrase(clip);
        const source = requireClip('c-loop');
        const span = range.endBeat - range.startBeat;
        const headEnd = Math.max(source.startBeat, Math.min(range.startBeat, source.endBeat));
        const tailStart = Math.min(source.endBeat, Math.max(range.endBeat, source.startBeat));
        const expected = [
            ...scoreMidiClips([source], source.startBeat, headEnd),
            ...shiftScore(scoreMidiClips([source], tailStart, source.endBeat), -span),
        ];

        const result = executeGlobalTimeOperation({
            operation: { type: 'delete', startBeat: range.startBeat, endBeat: range.endBeat },
        });
        expect(result.status).toBe('applied');

        const survivors = allClips();
        expect(expected.length).toBeGreaterThan(0);
        expect([
            ...scoreMidiClips(survivors, source.startBeat, headEnd),
            ...scoreMidiClips(survivors, tailStart - span, source.endBeat - span),
        ]).toEqual(expected);
        // The survivor's loop grid stays the source's: the anchored pass start
        // moves with the material it heads.
        const tail = survivors.find((clip) => clip.id !== 'c-loop');
        if (tail) {
            expect(resolveLoopAnchoredStartBeat(tail)).toBe(resolveLoopAnchoredStartBeat(source) - span);
        }
    });

    it('keeps re-basing the survivor of a MIDI clip that does not loop, without an anchor key', () => {
        midiStore.set({
            ...defaultMidiStoreState,
            notesByClipId: { 'c-loop': [{ id: 'n-a', pitch: 60, startBeat: 8.5, duration: 0.5, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        trackStore.set({
            ...defaultTrackState,
            tracks: [midiTrack([loopedClip({ loopEnabled: false, loopLength: undefined })])],
        });

        const result = executeGlobalTimeOperation({ operation: { type: 'delete', startBeat: 4, endBeat: 8 } });
        expect(result.status).toBe('applied');

        const fragment = requireRightFragment();
        expect(fragment.midiOffsetBeats).toBe(0);
        expect(Object.hasOwn(fragment, 'loopOriginBeat')).toBe(false);
        expect(midiStore.value?.notesByClipId[fragment.id]?.map((note) => note.startBeat)).toEqual([0.5]);
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
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { splitClip } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { readSecondsAtBeat, readTempoAtBeat, tempoMapStore } from '#/modules/Transport/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { resolveClipLoopOriginAdvance, resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { loopPhaseControllers, loopPhaseNotes, scoreMidiClips } from '../../../__tests__/midiClipScore';
import { createTrack } from '../../../models/Track';

/**
 * #4988 — the split write law: the right fragment's loop anchor follows its
 * basis. A looping MIDI fragment keeps the source's basis: it holds every row
 * of the source's loop unchanged and carries the source's anchor with its
 * content offset advanced by the split, so it plays the source's passes from
 * the split on. A MIDI fragment of a clip that does not loop re-bases its notes
 * (`midiOffsetBeats` 0, notes shifted down by the split) and restamps at its
 * own start. An audio fragment's media basis is preserved (its
 * `audioOffsetBeats` advances with the head by the same timeline delta the
 * carried anchor's advance grows by), so it keeps the carried anchor. A source
 * with no anchor leaves the key absent, never `undefined` (the CRDT normalizer
 * rebuilds optional fields as present-or-absent).
 */

const LOOP_LENGTH = 4;

function loopedMidiClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-loop',
        trackId: 't-keys',
        name: 'Loop',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        midiOffsetBeats: 0,
        loopEnabled: true,
        loopLength: LOOP_LENGTH,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function loopedAudioClip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c-audio',
        trackId: 't-keys',
        name: 'Loop audio',
        startBeat: 0,
        endBeat: 16,
        type: 'audio',
        audioOffsetBeats: 1,
        loopEnabled: true,
        loopLength: LOOP_LENGTH,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

/** A clip never looped: no loop state and no anchor key at all. */
function unloopedMidiClip(): Clip {
    return {
        id: 'c-plain',
        trackId: 't-keys',
        name: 'Plain',
        startBeat: 0,
        endBeat: 16,
        type: 'midi',
        midiOffsetBeats: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

function seedTrack(clips: Clip[]): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: [
            {
                ...createTrack({ id: 't-keys', name: 'Keys', kind: 'midi', withoutDefaultDevice: true }),
                clips,
            },
        ],
        selectedTrackId: 't-keys',
    });
}

function readClip(clipId: string): Clip {
    const found = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!found) {
        throw new Error(`Expected clip ${clipId} in the track store`);
    }
    return found;
}

function resetMidiStore(): void {
    midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
}

/** Projects one pass of the stored fragment through the real loop-window reader. */
function projectFragmentPass(clipId: string, iterationStartBeat: number): Array<{ id: string; startBeat: number }> {
    const clip = readClip(clipId);
    const notes = midiStore.value?.notesByClipId[clipId] ?? [];
    return projectClipMidiEvents({
        events: notes,
        clipId: clip.id,
        clipStartBeat: clip.startBeat,
        clipEndBeat: clip.endBeat,
        iterationStartBeat,
        loopLengthBeats: clip.loopLength ?? LOOP_LENGTH,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        loopEnabled: clip.loopEnabled ?? false,
        loopOriginBeat: clip.loopOriginBeat,
        clipGrooveAlreadyApplied: true,
    }).map((event) => ({ id: event.id, startBeat: event.startBeat }));
}

describe('splitClip loop anchoring', () => {
    beforeEach(() => {
        resetMidiStore();
    });

    afterEach(() => {
        resetMidiStore();
        tempoMapStore.set({ changes: [] });
    });

    it('consumes the internal tempo map at the bounded source rate when splitting audio', () => {
        tempoMapStore.set({
            changes: [
                { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        seedTrack([
            loopedAudioClip({
                startBeat: 2,
                endBeat: 10,
                loopEnabled: false,
                audioOffsetSeconds: 0.75,
                stretchMode: 'timestretch',
                stretchRatio: 1.5,
            }),
        ]);

        const rightId = splitClip('c-audio', 6);

        expect(rightId).not.toBeNull();
        // 2..4 takes one second and 4..6 takes two: source advances 3 × 1.5.
        expect(readClip(rightId!).audioOffsetSeconds).toBe(5.25);
        expect(readClip('c-audio').audioOffsetSeconds).toBe(0.75);
    });

    it('keeps the captured loop source boundary and timeline reset when splitting stretched audio', () => {
        tempoMapStore.set({
            changes: [
                { id: 'base', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        seedTrack([
            loopedAudioClip({
                startBeat: 2,
                endBeat: 10,
                loopOriginBeat: 2,
                audioOffsetSeconds: 0.75,
                audioLoopStartSeconds: 0.75,
                stretchMode: 'timestretch',
                stretchRatio: 1.5,
            }),
        ]);

        const rightId = splitClip('c-audio', 5);

        expect(rightId).not.toBeNull();
        const right = readClip(rightId!);
        const segments = projectAudioLoopPassSegments({
            clip: right,
            loopLengthBeats: 4,
            iterationStartBeat: 5,
            iterationEndBeat: 9,
            stretchRatio: 1.5,
            tempoAtClipStart: readTempoAtBeat({ beat: 5 }),
            secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
        });
        expect(segments).toEqual([
            { startOffsetBeats: 0, endOffsetBeats: 1, sourceStartSeconds: 3.75 },
            { startOffsetBeats: 1, endOffsetBeats: 4, sourceStartSeconds: 0.75 },
        ]);
    });

    // These two cases used to pin the restamp: the right fragment held only the
    // notes after the split, re-based to offset 0, and looped them from its own
    // head. That restarts the loop at the cut, so a split off the loop grid
    // changed what every later pass plays (beat 5 of the loop-4 clip below
    // played n-next where it had played n-head). A looping fragment now holds
    // the whole loop in the source's basis and carries the advanced offset and
    // the anchor, so its passes are the source's passes.
    it('carries the anchor and the whole loop onto a fragment split on the loop grid', () => {
        seedTrack([loopedMidiClip()]);
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'c-loop': [
                    { id: 'n-early', pitch: 60, startBeat: 1, duration: 0.5, velocity: 80 },
                    { id: 'n-late', pitch: 60, startBeat: 9, duration: 0.5, velocity: 80 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        const rightId = splitClip('c-loop', 8);
        expect(rightId).not.toBeNull();

        const right = readClip(rightId!);
        expect(right.startBeat).toBe(8);
        expect(right.midiOffsetBeats).toBe(8);
        expect(right.loopOriginBeat).toBe(0);
        expect(readClip('c-loop').loopOriginBeat).toBe(0);

        // n-late sits past the loop region, so the source never plays it; the
        // fragment plays the loop's n-early on every pass, as the source did.
        expect(projectFragmentPass(rightId!, 8)).toEqual([{ id: expect.any(String), startBeat: 9 }]);
        expect(projectFragmentPass(rightId!, 12)).toEqual([{ id: expect.any(String), startBeat: 13 }]);
    });

    it('keeps every pass on the source phase when the split falls inside the first loop span', () => {
        seedTrack([loopedMidiClip()]);
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'c-loop': [
                    { id: 'n-head', pitch: 60, startBeat: 1, duration: 0.5, velocity: 80 },
                    { id: 'n-tail', pitch: 62, startBeat: 3, duration: 0.5, velocity: 80 },
                    { id: 'n-next', pitch: 64, startBeat: 5, duration: 0.5, velocity: 80 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        const rightId = splitClip('c-loop', 2);
        expect(rightId).not.toBeNull();

        // The source plays n-head at 1, 5, 9, 13 and n-tail at 3, 7, 11, 15;
        // n-next is past the loop region and never sounds.
        const right = readClip(rightId!);
        expect(right.loopOriginBeat).toBe(0);
        const pitchesOf = (iterationStartBeat: number) =>
            projectFragmentPass(rightId!, iterationStartBeat).map((event) => ({
                pitch: midiStore.value?.notesByClipId[rightId!]?.find((note) => note.id === event.id)?.pitch,
                startBeat: event.startBeat,
            }));
        // The fragment's passes open on the source's seams 0, 4, 8 and 12; the
        // first opens before the fragment head at 2, which cuts n-head there.
        expect(pitchesOf(0)).toEqual([{ pitch: 62, startBeat: 3 }]);
        expect(pitchesOf(4)).toEqual([
            { pitch: 60, startBeat: 5 },
            { pitch: 62, startBeat: 7 },
        ]);
        expect(pitchesOf(8)).toEqual([
            { pitch: 60, startBeat: 9 },
            { pitch: 62, startBeat: 11 },
        ]);
        expect(pitchesOf(12)).toEqual([
            { pitch: 60, startBeat: 13 },
            { pitch: 62, startBeat: 15 },
        ]);
    });

    it('keeps the carried anchor on the audio fragment, whose offset advances with the head', () => {
        seedTrack([loopedAudioClip()]);

        const rightId = splitClip('c-audio', 8);
        expect(rightId).not.toBeNull();

        const right = readClip(rightId!);
        // The media basis is preserved: the offset advances by the split
        // delta and the carried anchor rides with it.
        expect(right.startBeat).toBe(8);
        expect(right.audioOffsetBeats).toBe(9);
        expect(right.loopOriginBeat).toBe(0);

        // The geometry every audio loop reader recovers per pass — the region
        // `audioOffsetBeats - (startBeat - loopOriginBeat)` and the entry
        // phase `advance % loopLength` (scheduleAudioClips,
        // projectOfflineAudioClipPlaybacks) — must be the source's own, so
        // the fragment re-enters the region it was looped with.
        const source = readClip('c-audio');
        const regionOf = (clip: Clip): { region: number; entry: number } => {
            const advance = resolveClipLoopOriginAdvance({
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopEnabled: clip.loopEnabled ?? false,
            });
            return {
                region: (clip.audioOffsetBeats ?? 0) - advance,
                entry: ((advance % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH,
            };
        };
        expect(regionOf(right)).toEqual(regionOf(source));
    });

    it('captures the original physical source anchors when splitting stretched legacy audio', () => {
        seedTrack([
            loopedAudioClip({
                startBeat: 1,
                endBeat: 9,
                loopLength: LOOP_LENGTH,
                stretchMode: 'timestretch',
                stretchRatio: 2,
            }),
        ]);

        const rightId = splitClip('c-audio', 5);
        expect(rightId).not.toBeNull();

        const right = readClip(rightId!);
        expect(right.startBeat).toBe(5);
        expect(right.audioOffsetBeats).toBe(9);
        expect(right).toMatchObject({
            loopOriginBeat: 0,
            audioOffsetSeconds: 0.5,
            audioLoopStartSeconds: 0,
            audioLoopPassEntrySeconds: 0.5,
            audioLoopPassOriginBeat: 1,
        });
        expect(
            projectAudioLoopPassSegments({
                clip: right,
                loopLengthBeats: 4,
                iterationStartBeat: 5,
                iterationEndBeat: 9,
                stretchRatio: 2,
                tempoAtClipStart: 120,
                secondsAtBeat: (beat) => beat / 2,
            })
        ).toEqual([
            { startOffsetBeats: 0, endOffsetBeats: 3, sourceStartSeconds: 0.5 },
            { startOffsetBeats: 3, endOffsetBeats: 4, sourceStartSeconds: 0 },
        ]);
    });

    it('leaves the loopOriginBeat key absent when the source was never anchored', () => {
        seedTrack([unloopedMidiClip()]);

        const rightId = splitClip('c-plain', 8);
        expect(rightId).not.toBeNull();

        // Key absent, never written undefined: clip snapshots are compared
        // structurally and encoded by plans that reject explicit undefined.
        const right = readClip(rightId!);
        expect(Object.hasOwn(right, 'loopOriginBeat')).toBe(false);
        expect(right.loopOriginBeat).toBeUndefined();
    });
});

describe('splitting a looping MIDI clip keeps every beat it plays', () => {
    beforeEach(() => {
        resetMidiStore();
    });

    afterEach(() => {
        resetMidiStore();
    });

    it.each([
        { name: 'a loop-4 clip split inside its first pass', clip: {}, splitBeat: 2 },
        { name: 'a loop-4 clip split one beat into its second pass', clip: {}, splitBeat: 5 },
        { name: 'a loop-4 clip split one beat into its third pass', clip: {}, splitBeat: 9 },
        {
            name: 'a start-trimmed clip',
            clip: { startBeat: 1, endBeat: 17, midiOffsetBeats: 1, loopOriginBeat: 0 },
            splitBeat: 6,
        },
        {
            name: 'a clip anchored before its start',
            clip: { startBeat: 3, endBeat: 19, midiOffsetBeats: 2, loopOriginBeat: 1 },
            splitBeat: 8.5,
        },
        { name: 'a clip whose loop is its whole length', clip: { endBeat: 12, loopLength: undefined }, splitBeat: 5 },
        { name: 'a looping clip with no anchor', clip: { loopOriginBeat: undefined }, splitBeat: 6 },
    ])("plays the source's notes and controllers on every beat after splitting $name", ({ clip, splitBeat }) => {
        const source = loopedMidiClip(clip);
        if (source.loopLength === undefined) {
            delete source.loopLength;
        }
        if (source.loopOriginBeat === undefined) {
            delete source.loopOriginBeat;
        }
        seedTrack([source]);
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'c-loop': loopPhaseNotes() },
            ccByClipId: { 'c-loop': loopPhaseControllers() },
            pitchBendByClipId: {},
        });
        const before = scoreMidiClips([source], source.startBeat, source.endBeat);
        // The fixture is not vacuous: the source strikes notes on several passes.
        expect(before.filter((beat) => beat.struck.length > 0).length).toBeGreaterThan(4);

        const rightId = splitClip('c-loop', splitBeat);
        expect(rightId).not.toBeNull();

        const left = readClip('c-loop');
        const right = readClip(rightId!);
        expect(scoreMidiClips([left, right], source.startBeat, source.endBeat)).toEqual(before);
        // The probability roll counts passes from the loop anchor; the fragment
        // counts from the source's, so its first pass is the source pass the
        // split falls in rather than pass zero.
        const anchoredStartOf = (candidate: Clip) =>
            resolveLoopAnchoredStartBeat({
                startBeat: candidate.startBeat,
                loopOriginBeat: candidate.loopOriginBeat,
                loopEnabled: candidate.loopEnabled ?? false,
            });
        expect(anchoredStartOf(right)).toBe(anchoredStartOf(source));
    });

    it('keeps re-basing the right fragment of a clip that does not loop', () => {
        const source = unloopedMidiClip();
        seedTrack([source]);
        // No note crosses the split: a clip that does not loop splits a note
        // that does into two notes, the right one struck at the split.
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'c-plain': loopPhaseNotes().filter((note) => note.id !== 'n-b'),
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        const before = scoreMidiClips([source], 0, 16);

        const rightId = splitClip('c-plain', 2);
        expect(rightId).not.toBeNull();

        const right = readClip(rightId!);
        expect(right.midiOffsetBeats).toBe(0);
        expect(midiStore.value?.notesByClipId[rightId!]?.map((note) => [note.pitch, note.startBeat])).toEqual([
            [66, 0.5],
            [64, 1],
            [70, 3],
        ]);
        expect(midiStore.value?.notesByClipId['c-plain']?.map((note) => [note.pitch, note.startBeat])).toEqual([
            [60, 0.5],
        ]);
        expect(scoreMidiClips([readClip('c-plain'), right], 0, 16)).toEqual(before);
    });
});

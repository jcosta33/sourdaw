import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { splitClip } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';

import { createTrack } from '../../../models/Track';

/**
 * #4988 — the split write law: the right fragment's loop anchor follows its
 * basis. A MIDI fragment re-bases its notes (`midiOffsetBeats` 0, notes
 * shifted down by the split), so the source's timeline anchor derives a
 * spurious advance there — the loop window opens behind the fragment's head,
 * a split past the first loop span projects nothing and one inside it drops
 * the tail of every pass — and the fragment restamps at its own start. An
 * audio fragment's media basis is preserved (its `audioOffsetBeats` advances
 * with the head by the same timeline delta the carried anchor's advance grows
 * by), so it keeps the carried anchor. A source with no anchor leaves the key
 * absent, never `undefined` (the CRDT normalizer rebuilds optional fields as
 * present-or-absent).
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
    });

    it('restamps the MIDI fragment anchor at its own start so the fragment keeps sounding', () => {
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
        expect(right.midiOffsetBeats).toBe(0);
        // The fragment re-based its notes, so the source anchor at 0 no longer
        // means anything in its coordinates: it restamps at its own start.
        expect(right.loopOriginBeat).toBe(8);
        // The left fragment keeps the original basis and start, so it keeps
        // the source anchor.
        expect(readClip('c-loop').loopOriginBeat).toBe(0);

        // Projecting the fragment as stored: the rebased note sounds in every
        // pass. Under the carried anchor (advance 8, window [-8, -4)) this
        // projection returns nothing at all.
        expect(projectFragmentPass(rightId!, 8)).toEqual([{ id: 'n-late', startBeat: 9 }]);
        expect(projectFragmentPass(rightId!, 12)).toEqual([{ id: 'n-late', startBeat: 13 }]);
    });

    it('keeps every pass whole when the split falls inside the first loop span', () => {
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

        // The fragment [2, 16) holds the rebased tail notes (media 1 and 3)
        // and restamps at 2: full passes sound. The carried anchor would
        // advance 2 and open the window at [-2, 2), dropping the media-3
        // note — the tail of every pass — from all of them.
        const right = readClip(rightId!);
        expect(right.loopOriginBeat).toBe(2);
        expect(projectFragmentPass(rightId!, 2)).toEqual([
            { id: 'n-tail', startBeat: 3 },
            { id: 'n-next', startBeat: 5 },
        ]);
        expect(projectFragmentPass(rightId!, 6)).toEqual([
            { id: 'n-tail', startBeat: 7 },
            { id: 'n-next', startBeat: 9 },
        ]);
        expect(projectFragmentPass(rightId!, 10)).toEqual([
            { id: 'n-tail', startBeat: 11 },
            { id: 'n-next', startBeat: 13 },
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

    it('shifts the carried anchor by the stretch difference so a stretched split keeps the source read', () => {
        // The offset advances by the media delta — `timelineSplitDelta *
        // stretch` (pinned in splitClip.spec) — while an unshifted anchor's
        // advance would grow by the timeline delta alone, displacing the
        // recovered region by `splitDelta * (stretch - 1)` source beats and
        // putting the fragment on the wrong material at the cut. The anchor
        // absorbs the difference: shifted by `timelineSplitDelta -
        // contentSplitDelta`, its advance grows by the same media delta the
        // offset advanced by, and the recovered geometry stays the source's.
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

        // Measured figures: timeline delta 4, media delta 8 — offset
        // 1 + 8 = 9, anchor 0 + (4 - 8) = -4.
        const right = readClip(rightId!);
        expect(right.startBeat).toBe(5);
        expect(right.audioOffsetBeats).toBe(9);
        expect(right.loopOriginBeat).toBe(-4);

        const source = readClip('c-audio');
        // The advance is deliberately different — it grows by the media delta
        // alongside the offset — so the recovered geometry, not the advance,
        // is the invariant: region and entry phase must equal the source's.
        const geometryOf = (clip: Clip): { region: number; entry: number } => {
            const advance = resolveClipLoopOriginAdvance({
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopEnabled: clip.loopEnabled ?? false,
            });
            return {
                region: (clip.audioOffsetBeats ?? 0) - advance,
                entry: ((advance % clip.loopLength!) + clip.loopLength!) % clip.loopLength!,
            };
        };
        expect(geometryOf(right)).toEqual(geometryOf(source));
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

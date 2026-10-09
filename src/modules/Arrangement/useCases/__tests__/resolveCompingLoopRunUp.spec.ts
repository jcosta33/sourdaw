import { describe, expect, it, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { type Take } from '../../models/TakeLane';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { resolveClipsWithComping } from '../resolveComping';

const mocks = vi.hoisted(() => ({
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
}));

vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn(),
    },
}));

function recording(startBeat: number, endBeat: number, audioOffsetBeats?: number): Clip {
    const clip: Clip = {
        id: 'rec',
        trackId: 't1',
        name: 'Recording',
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId: 'rec-buf',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000',
        locked: false,
        muted: false,
    };
    if (audioOffsetBeats !== undefined) {
        clip.audioOffsetBeats = audioOffsetBeats;
    }
    return clip;
}

/**
 * A pass as commit leaves it, given in beats of the session's flat 120 BPM:
 * its media depth, and where it sounds from the clip's media origin. Commit
 * holds both in media seconds, two beats to the second.
 */
function passTake(id: string, loopStart: number, loopEnd: number, depthBeats: number, anchorBeats: number) {
    return {
        id,
        clipId: 'rec',
        name: id,
        startBeat: loopStart,
        endBeat: loopEnd,
        selected: false,
        sourceOffsetBeats: depthBeats,
        passAnchorSeconds: anchorBeats / 2,
        passDepthSeconds: depthBeats / 2,
    };
}

function compPass(takes: Take[], takeId: string, startBeat: number, endBeat: number) {
    mocks.takeLaneStoreValue.value = {
        lanes: [
            {
                id: 'lane-1',
                trackId: 't1',
                takes,
                activeCompRegions: [{ startBeat, endBeat, takeId }],
            },
        ],
    };
}

/** Buffer position, in beats into the recording, that the resolved clips play at timeline `beat`. */
function bufferBeatAt(clips: readonly Clip[], beat: number): number | null {
    const clip = clips.find((candidate) => candidate.startBeat <= beat && beat < candidate.endBeat);
    if (!clip) {
        return null;
    }
    return beat - clip.startBeat + (clip.audioOffsetBeats ?? 0);
}

describe('resolveClipsWithComping — loop takes of a recording that did not start at the loop start', () => {
    it('plays pass 1 from its own media when recording started one beat before the loop', () => {
        const takes = [passTake('pass-1', 2, 6, 1, 1), passTake('pass-2', 2, 6, 5, 1)];
        compPass(takes, 'pass-1', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(1, 10)]);

        expect(bufferBeatAt(out, 2)).toBe(1);
        expect(bufferBeatAt(out, 5)).toBe(4);
    });

    it('plays pass 2 from the media recorded in that pass when recording started before the loop', () => {
        const takes = [passTake('pass-1', 2, 6, 1, 1), passTake('pass-2', 2, 6, 5, 1)];
        compPass(takes, 'pass-2', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(1, 10)]);

        expect(bufferBeatAt(out, 2)).toBe(5);
        expect(bufferBeatAt(out, 5)).toBe(8);
    });

    it('plays pass 2 across the whole loop when recording started inside it', () => {
        // Recorded from beat 12 inside loop [8,16): the clip commits at the loop
        // start with its media origin kept on the record point.
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(8, 24, -4)]);

        expect(bufferBeatAt(out, 8)).toBe(4);
        expect(bufferBeatAt(out, 12)).toBe(8);
        expect(bufferBeatAt(out, 15)).toBe(11);
    });

    it('keeps pass 1 silent until the record point when recording started inside the loop', () => {
        // Commit starts that first pass where its media does, at the record
        // point, so it sounds from the media origin.
        compPass([passTake('pass-1', 12, 16, 0, 0)], 'pass-1', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(8, 24, -4)]);

        expect(bufferBeatAt(out, 8)).toBeNull();
        expect(bufferBeatAt(out, 11)).toBeNull();
        expect(bufferBeatAt(out, 12)).toBe(0);
        expect(bufferBeatAt(out, 15)).toBe(3);
    });

    it('sounds no pass before its clip starts, wherever the pass was placed', () => {
        // A clip opening on the record point, as one committed before the loop
        // start rule did: the pass placed before it is cut at the clip start.
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(12, 24)]);

        expect(out.every((clip) => clip.startBeat >= 12)).toBe(true);
        expect(bufferBeatAt(out, 8)).toBeNull();
        expect(bufferBeatAt(out, 12)).toBe(8);
    });

    it('stays silent before a clip start trimmed into the media', () => {
        // Loop [0,4) recorded from beat 0, then the clip start trimmed to beat 1.
        compPass([passTake('pass-1', 0, 4, 0, 0)], 'pass-1', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(1, 12, 1)]);

        expect(bufferBeatAt(out, 0.5)).toBeNull();
        expect(bufferBeatAt(out, 1)).toBe(1);
        expect(bufferBeatAt(out, 3)).toBe(3);
    });

    it('is unchanged when recording started exactly at the loop start', () => {
        const takes = [passTake('pass-1', 0, 4, 0, 0), passTake('pass-2', 0, 4, 4, 0)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(0, 12)]);

        expect(bufferBeatAt(out, 0)).toBe(4);
        expect(bufferBeatAt(out, 3)).toBe(7);
    });

    it('plays pass 2 from the media captured in that pass when the capture began before the record point', () => {
        // Loop [2,6), provisional anchor 1, capture latency 0.5 beat: the media
        // origin is 0.5 and the committed clip starts there. Commit rebased
        // pass 2's offset from 5 to 5.5 and placed it 1.5 beats after the origin.
        const takes = [passTake('pass-1', 2, 6, 1.5, 1.5), passTake('pass-2', 2, 6, 5.5, 1.5)];
        compPass(takes, 'pass-2', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(0.5, 10)]);

        expect(out.find((clip) => clip.startBeat === 2)?.audioOffsetBeats).toBe(5.5);
        expect(bufferBeatAt(out, 5)).toBe(8.5);
    });

    it('plays pass 2 from the media captured in that pass when the capture began before beat 0', () => {
        // Recording from the loop start at beat 0 with 0.5 beat of latency: the
        // origin is -0.5, so the clip is clamped to 0 and skips 0.5 of media.
        // Pass 2 starts 4.5 beats into the media.
        const takes = [passTake('pass-1', 0, 4, 0.5, 0.5), passTake('pass-2', 0, 4, 4.5, 0.5)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(0, 12, 0.5)]);

        expect(bufferBeatAt(out, 0)).toBe(4.5);
        expect(bufferBeatAt(out, 3)).toBe(7.5);
    });

    it('leaves a take that was never loop-recorded on its clip’s own media origin', () => {
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 't1',
                    takes: [{ id: 'take-1', clipId: 'rec', name: 'Take 1', startBeat: 0, endBeat: 8, selected: false }],
                    activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: 'take-1' }],
                },
            ],
        };

        const out = resolveClipsWithComping('t1', [recording(0, 8, 0.5)]);

        expect(bufferBeatAt(out, 2)).toBe(2.5);
        expect(bufferBeatAt(out, 0)).toBe(0.5);
    });
});

describe('resolveClipsWithComping — legacy passes of a clip trimmed before pass placement existed', () => {
    /** A pass as a pre-#4987 build saved it: a media depth only, no placement seconds (#4996). */
    function legacyPassTake(id: string, startBeat: number, endBeat: number, sourceOffsetBeats: number) {
        return {
            id,
            clipId: 'rec',
            name: id,
            startBeat,
            endBeat,
            selected: false,
            sourceOffsetBeats,
        };
    }

    it('keeps a pre-#4987 trimmed loop clip hiding its trimmed material on reopen', () => {
        // Loop [0,4) recorded from beat 0 for two passes, then the clip start
        // trimmed to beat 1 and saved before placement existed. Comp pass 1 and
        // play from beat 0: nothing sounds before the clip, and the first
        // remaining beat enters one beat into the media — not the trimmed head.
        const takes = [legacyPassTake('pass-1', 0, 4, 0), legacyPassTake('pass-2', 0, 4, 4)];
        compPass(takes, 'pass-1', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(1, 8, 1)]);

        expect(bufferBeatAt(out, 0.5)).toBeNull();
        expect(bufferBeatAt(out, 1)).toBe(1);
        expect(bufferBeatAt(out, 3)).toBe(3);
    });

    it('keeps a deeper pass of the same clip out of the trimmed head', () => {
        const takes = [legacyPassTake('pass-1', 0, 4, 0), legacyPassTake('pass-2', 0, 4, 4)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(1, 8, 1)]);

        expect(bufferBeatAt(out, 0.5)).toBeNull();
        expect(bufferBeatAt(out, 1)).toBe(5);
        expect(bufferBeatAt(out, 3)).toBe(7);
    });

    it('sounds a legitimate pass from the record point when recording started inside the loop', () => {
        // Pre-#4987 shape: the clip commits at the record point 2, and pass 2
        // spans the loop from before it. The pass stays silent before the clip
        // and plays its own material from the record point on.
        const takes = [legacyPassTake('pass-1', 2, 8, 0), legacyPassTake('pass-2', 0, 4, 2)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(2, 8)]);

        expect(bufferBeatAt(out, 1)).toBeNull();
        expect(bufferBeatAt(out, 2)).toBe(2);
        expect(bufferBeatAt(out, 3)).toBe(3);
    });
});

describe('resolveClipsWithComping — a comped pass follows edits to its clip', () => {
    const loopPasses = () => [passTake('pass-1', 0, 4, 0, 0), passTake('pass-2', 0, 4, 4, 0)];

    it('sounds nothing outside a clip moved away from the comped span', () => {
        compPass(loopPasses(), 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(8, 20)]);

        expect(out.every((clip) => clip.startBeat >= 8 && clip.endBeat <= 20)).toBe(true);
        expect(bufferBeatAt(out, 2)).toBeNull();
        expect(bufferBeatAt(out, 8)).toBe(0);
    });

    it('plays the pass where the moved clip now holds it', () => {
        compPass(loopPasses(), 'pass-2', 8, 12);

        const out = resolveClipsWithComping('t1', [recording(8, 20)]);

        expect(bufferBeatAt(out, 8)).toBe(4);
        expect(bufferBeatAt(out, 11)).toBe(7);
        expect(bufferBeatAt(out, 12)).toBe(4);
    });

    it('carries a pass recorded ahead of its media with the clip', () => {
        // Recorded inside loop [8,16) from beat 12, then the clip moved 8 beats later.
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 16, 24);

        const out = resolveClipsWithComping('t1', [recording(16, 32, -4)]);

        expect(bufferBeatAt(out, 16)).toBe(4);
        expect(bufferBeatAt(out, 20)).toBe(8);
    });

    it('shifts a pass recorded ahead of its media with content slipped inside its clip', () => {
        // Recorded inside loop [8,16) from beat 12, then the content slipped one
        // beat later into the media: pass 2 still fills the loop, a beat deeper.
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(8, 24, -3)]);

        expect(bufferBeatAt(out, 8)).toBe(5);
        expect(bufferBeatAt(out, 15)).toBe(12);
    });

    it('hides what a start trim hides of a pass recorded ahead of its media', () => {
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(10, 24, -2)]);

        expect(bufferBeatAt(out, 9)).toBeNull();
        expect(bufferBeatAt(out, 10)).toBe(6);
    });

    it('shifts the comped pass with content slipped inside the clip', () => {
        compPass(loopPasses(), 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(0, 12, 1)]);

        expect(bufferBeatAt(out, 0)).toBe(5);
        expect(bufferBeatAt(out, 3)).toBe(8);
        expect(bufferBeatAt(out, 4)).toBe(5);
    });

    it('hides a pass recorded ahead of its media once the clip start is trimmed into the media', () => {
        compPass([passTake('pass-2', 8, 16, 4, -4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(14, 24, 2)]);

        expect(bufferBeatAt(out, 12)).toBeNull();
        expect(bufferBeatAt(out, 14)).toBe(10);
    });
});

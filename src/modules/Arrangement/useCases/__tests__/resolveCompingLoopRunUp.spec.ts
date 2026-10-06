import { describe, expect, it, vi } from 'vitest';

import { type Clip } from '../../models/Track';
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

function passTake(id: string, loopStart: number, loopEnd: number, sourceOffsetBeats: number) {
    return { id, clipId: 'rec', name: id, startBeat: loopStart, endBeat: loopEnd, selected: false, sourceOffsetBeats };
}

function compPass(takes: ReturnType<typeof passTake>[], takeId: string, startBeat: number, endBeat: number) {
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
        const takes = [passTake('pass-1', 2, 6, 1), passTake('pass-2', 2, 6, 5)];
        compPass(takes, 'pass-1', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(1, 10)]);

        expect(bufferBeatAt(out, 2)).toBe(1);
        expect(bufferBeatAt(out, 5)).toBe(4);
    });

    it('plays pass 2 from the media recorded in that pass when recording started before the loop', () => {
        const takes = [passTake('pass-1', 2, 6, 1), passTake('pass-2', 2, 6, 5)];
        compPass(takes, 'pass-2', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(1, 10)]);

        expect(bufferBeatAt(out, 2)).toBe(5);
        expect(bufferBeatAt(out, 5)).toBe(8);
    });

    it('plays pass 2 across the whole loop when recording started inside it', () => {
        compPass([passTake('pass-2', 8, 16, 4)], 'pass-2', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(12, 24)]);

        expect(bufferBeatAt(out, 8)).toBe(4);
        expect(bufferBeatAt(out, 12)).toBe(8);
    });

    it('keeps pass 1 silent until the record point when recording started inside the loop', () => {
        // Commit starts that first pass where its media does, at the record
        // point, so its media origin is the record point.
        compPass([passTake('pass-1', 12, 16, 0)], 'pass-1', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(12, 24)]);

        expect(bufferBeatAt(out, 8)).toBeNull();
        expect(bufferBeatAt(out, 12)).toBe(0);
        expect(bufferBeatAt(out, 15)).toBe(3);
    });

    it('stays silent before the clip start for a pass whose start a trim moved later', () => {
        // Loop [0,4) recorded from beat 0, then the clip start trimmed to beat 1:
        // the trim left pass 1 starting at beat 1 with the media origin still at 0.
        compPass([passTake('pass-1', 1, 4, 1)], 'pass-1', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(1, 12, 1)]);

        expect(bufferBeatAt(out, 0.5)).toBeNull();
        expect(bufferBeatAt(out, 1)).toBe(1);
        expect(bufferBeatAt(out, 3)).toBe(3);
    });

    it('is unchanged when recording started exactly at the loop start', () => {
        const takes = [passTake('pass-1', 0, 4, 0), passTake('pass-2', 0, 4, 4)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(0, 12)]);

        expect(bufferBeatAt(out, 0)).toBe(4);
        expect(bufferBeatAt(out, 3)).toBe(7);
    });

    it('plays pass 2 from the media captured in that pass when the capture began before the record point', () => {
        // Loop [2,6), provisional anchor 1, capture latency 0.5 beat: the media
        // origin is 0.5 and the committed clip starts there. Commit rebased
        // pass 2's offset from 5 to 5.5. Pass 2 spans media beats [5.5, 9.5), so
        // the fragment enters the media at the unwrapped pass start (6) less the
        // origin.
        const takes = [passTake('pass-1', 2, 6, 1.5), passTake('pass-2', 2, 6, 5.5)];
        compPass(takes, 'pass-2', 2, 6);

        const out = resolveClipsWithComping('t1', [recording(0.5, 10)]);

        expect(out.find((clip) => clip.startBeat === 2)?.audioOffsetBeats).toBe(5.5);
        expect(bufferBeatAt(out, 5)).toBe(8.5);
    });

    it('plays pass 2 from the media captured in that pass when the capture began before beat 0', () => {
        // Recording from the loop start at beat 0 with 0.5 beat of latency: the
        // origin is -0.5, so the clip is clamped to 0 and skips 0.5 of media.
        // Pass 2 starts 4.5 beats into the media.
        const takes = [passTake('pass-1', 0, 4, 0.5), passTake('pass-2', 0, 4, 4.5)];
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

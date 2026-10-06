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

function recording(startBeat: number, endBeat: number): Clip {
    return {
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
        compPass([passTake('pass-1', 8, 16, 0)], 'pass-1', 8, 16);

        const out = resolveClipsWithComping('t1', [recording(12, 24)]);

        expect(bufferBeatAt(out, 8)).toBeNull();
        expect(bufferBeatAt(out, 12)).toBe(0);
        expect(bufferBeatAt(out, 15)).toBe(3);
    });

    it('is unchanged when recording started exactly at the loop start', () => {
        const takes = [passTake('pass-1', 0, 4, 0), passTake('pass-2', 0, 4, 4)];
        compPass(takes, 'pass-2', 0, 4);

        const out = resolveClipsWithComping('t1', [recording(0, 12)]);

        expect(bufferBeatAt(out, 0)).toBe(4);
        expect(bufferBeatAt(out, 3)).toBe(7);
    });
});

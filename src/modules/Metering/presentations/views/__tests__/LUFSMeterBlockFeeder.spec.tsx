/**
 * The meter's block feeder must retain whatever a frame's read straddles past
 * the 400 ms block boundary: a read that crosses the 19,200-frame line leaves
 * the next block's head held, and losing that retention pushes already-drawn
 * samples to the meter again while fresh programme waits past the release
 * window. The LUFSMeterWindow spec reads 256-sample frames at 48 kHz, and
 * 19,200 divides by 256, so no remainder ever forms there — this spec drives
 * the rendered component's tap with frame sizes that straddle the boundaries.
 *
 * `MomentaryLUFS` is doubled in the barrel to capture the exact frames the
 * closure's feeder hands the meter; the rest of the barrel stays real. The
 * programme encodes each sample's stream position in its value, so a
 * duplicated, dropped, or reordered sample breaks equality rather than only
 * the block counts (a periodic tone would alias).
 */

import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
    /** Programme samples: each value is its stream position, never repeating. */
    const leftSampleAt = (index: number): number => (index + 1) / 1_000_000;
    const rightSampleAt = (index: number): number => -(index + 1) / 1_000_000;

    const cursors = { left: 0, right: 0 };

    const tapAnalyser = (channel: 'left' | 'right') => ({
        fftSize: 256,
        getFloatTimeDomainData: (arr: Float32Array): void => {
            const sampleAt = channel === 'left' ? leftSampleAt : rightSampleAt;
            for (let index = 0; index < arr.length; index += 1) {
                arr[index] = sampleAt(cursors[channel] + index);
            }
            cursors[channel] += arr.length;
        },
    });

    const pushes: { left: Float32Array; right: Float32Array }[] = [];

    /** Stands in for the real meter at the barrel so released frames are observable. */
    class CapturingMomentaryLUFS {
        // The component constructs it from the engine's sample rate.
        constructor(_sampleRate: number) {}
        push(left: Float32Array, right: Float32Array): void {
            // The closure reuses its pending buffer across releases, so capture copies.
            pushes.push({ left: Float32Array.from(left), right: Float32Array.from(right) });
        }
        get filled(): boolean {
            return true;
        }
        get energy(): number {
            return 0;
        }
        get value(): number {
            return -70;
        }
    }

    return {
        leftSampleAt,
        rightSampleAt,
        cursors,
        leftAnalyser: tapAnalyser('left'),
        rightAnalyser: tapAnalyser('right'),
        pushes,
        CapturingMomentaryLUFS,
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    // The real barrel with one swap: `MomentaryLUFS` is the capture double so
    // the exact frames the closure's feeder releases are observable at the
    // meter boundary. The real ShortTermLUFS and IntegratedLUFS keep consuming
    // the double's energy figure downstream.
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    MomentaryLUFS: harness.CapturingMomentaryLUFS,
    getAudioSampleRate: () => 48_000,
    getMasterStereoAnalysers: () => ({ left: harness.leftAnalyser, right: harness.rightAnalyser }),
}));

import { LUFSMeter } from '../LUFSMeter';

/** The shipped loop runs per animation frame; frames are driven, not timed. */
let frameCallbacks: FrameRequestCallback[] = [];
let framesDriven = 0;

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
});
vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    frameCallbacks = frameCallbacks.filter((_, index) => index !== id - 1);
});

/** The component throttles React updates against `performance.now()`. */
vi.spyOn(performance, 'now').mockImplementation(() => framesDriven * 16.7);

const runFrames = (count: number): void => {
    act(() => {
        for (let frame = 0; frame < count; frame += 1) {
            const callbacks = frameCallbacks;
            frameCallbacks = [];
            framesDriven += 1;
            for (const callback of callbacks) {
                callback(framesDriven * 16.7);
            }
        }
    });
};

/** One animation frame whose tap read carries `samples` frames. */
const runFrameWithRead = (samples: number): void => {
    harness.leftAnalyser.fftSize = samples;
    harness.rightAnalyser.fftSize = samples;
    runFrames(1);
};

const repeat = (samples: number, times: number): number[] => Array.from({ length: times }, () => samples);

/**
 * Read sizes whose running total straddles every 19,200-frame boundary: three
 * blocks released, 9,750 frames held after the cadence, and single reads
 * (32,768) long enough to hold more than one whole block.
 */
const boundaryStraddlingReads = [
    ...repeat(256, 3),
    333,
    7_000,
    ...repeat(256, 10),
    32_768,
    1,
    5_000,
    17_640,
    ...repeat(256, 5),
];

/** The programme as it should have reached the meter, sample by sample. */
const expectedStream = (sampleAt: (index: number) => number, from: number, to: number): Float32Array => {
    const stream = new Float32Array(to - from);
    for (let index = 0; index < stream.length; index += 1) {
        stream[index] = sampleAt(from + index);
    }
    return stream;
};

/** The exact samples the meter received across the given pushes, in order. */
const receivedStream = (channel: 'left' | 'right', fromPush: number, toPush: number): Float32Array => {
    const frames = harness.pushes.slice(fromPush, toPush).map((push) => push[channel]);
    const stream = new Float32Array(frames.reduce((total, frame) => total + frame.length, 0));
    let offset = 0;
    for (const frame of frames) {
        stream.set(frame, offset);
        offset += frame.length;
    }
    return stream;
};

const BLOCK_FRAMES = 19_200;

afterEach(() => {
    frameCallbacks = [];
    framesDriven = 0;
    harness.cursors.left = 0;
    harness.cursors.right = 0;
    harness.pushes.length = 0;
    harness.leftAnalyser.fftSize = 256;
    harness.rightAnalyser.fftSize = 256;
});

describe('LUFSMeter block feeder', () => {
    it('pushes whole blocks with the boundary remainder retained, every sample exactly once in order', () => {
        // The mount frame's draw performs the cadence's first 256-sample read.
        render(<LUFSMeter />);
        for (const samples of boundaryStraddlingReads.slice(1)) {
            runFrameWithRead(samples);
        }

        expect(harness.pushes).toHaveLength(3);
        for (const push of harness.pushes) {
            expect(push.left).toHaveLength(BLOCK_FRAMES);
            expect(push.right).toHaveLength(BLOCK_FRAMES);
        }
        expect(receivedStream('left', 0, 3)).toEqual(expectedStream(harness.leftSampleAt, 0, 3 * BLOCK_FRAMES));
        expect(receivedStream('right', 0, 3)).toEqual(expectedStream(harness.rightSampleAt, 0, 3 * BLOCK_FRAMES));

        // The 9,750 held frames are the fourth block's head: the block's
        // remaining 9,450 releases them first, in order, ahead of fresh reads.
        runFrameWithRead(BLOCK_FRAMES - 9_750);
        expect(harness.pushes).toHaveLength(4);
        expect(receivedStream('left', 3, 4)).toEqual(
            expectedStream(harness.leftSampleAt, 3 * BLOCK_FRAMES, 4 * BLOCK_FRAMES)
        );
        expect(receivedStream('right', 3, 4)).toEqual(
            expectedStream(harness.rightSampleAt, 3 * BLOCK_FRAMES, 4 * BLOCK_FRAMES)
        );

        // Frames short of a block stay held; nothing partial reaches the meter.
        runFrameWithRead(256);
        runFrameWithRead(256);
        expect(harness.pushes).toHaveLength(4);
        const consumed = 67_350 + 9_450 + 512;
        expect(harness.cursors).toEqual({ left: consumed, right: consumed });
    });
});

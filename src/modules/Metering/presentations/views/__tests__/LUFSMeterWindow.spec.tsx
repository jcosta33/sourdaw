/**
 * The meter's windows are BS.1770 lengths of programme, not of wall time.
 *
 * The real meters stay in the barrel; only the engine access is doubled — a
 * scripted tap that delivers `fftSize` (256) samples per animation frame at
 * the shipped rAF cadence, exactly what the master analysers hand the
 * component. Because one frame's read never carries a whole 400 ms block
 * while the audio clock moves further between frames, the short-term reading
 * only spans three seconds of programme when whole blocks are fed.
 *
 * The programme is dual-mono EBU R128 reference tone (48 kHz, 1 kHz, -23 dBFS
 * on both channels) for eight blocks, then digital silence. Seven silent
 * blocks later the 3 s window holds one tone block and seven silent ones, so
 * the correct short-term reading is the energy mean 10·log10(1/8) below the
 * tone: -32.0 LUFS. A meter fed per frame holds only its last eight frame
 * reads — pure silence by then — and reads the floor.
 */

import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const tap = vi.hoisted(() => {
    /** Eight 400 ms blocks of tone at 48 kHz, then the tap reads silence. */
    const toneSamples = 153_600;
    const amplitude = 10 ** (-23 / 20);
    /** Dual-mono reference tone: identical programme on both channels. */
    const programme = new Float32Array(toneSamples);
    for (let index = 0; index < programme.length; index += 1) {
        programme[index] = amplitude * Math.sin((2 * Math.PI * 1000 * index) / 48000);
    }
    const readAt = (cursor: number, index: number): number =>
        cursor + index < toneSamples ? programme[cursor + index]! : 0;

    return {
        leftCursor: 0,
        rightCursor: 0,
        /** One frame's read: the tap's newest `fftSize` samples, then it advances. */
        leftAnalyser: {
            fftSize: 256,
            getFloatTimeDomainData: (arr: Float32Array): void => {
                for (let index = 0; index < arr.length; index += 1) {
                    arr[index] = readAt(tap.leftCursor, index);
                }
                tap.leftCursor += arr.length;
            },
        },
        rightAnalyser: {
            fftSize: 256,
            getFloatTimeDomainData: (arr: Float32Array): void => {
                for (let index = 0; index < arr.length; index += 1) {
                    arr[index] = readAt(tap.rightCursor, index);
                }
                tap.rightCursor += arr.length;
            },
        },
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    // The real barrel: the real MomentaryLUFS, ShortTermLUFS, and
    // IntegratedLUFS must measure the programme. Only the engine access is
    // replaced.
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioSampleRate: () => 48_000,
    getMasterStereoAnalysers: () => ({ left: tap.leftAnalyser, right: tap.rightAnalyser }),
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

const shortTermReading = (): string => {
    const label = document.querySelector('canvas')?.getAttribute('aria-label') ?? '';
    return /Short-term ([^,]+),/.exec(label)?.[1] ?? '';
};

afterEach(() => {
    frameCallbacks = [];
    framesDriven = 0;
    tap.leftCursor = 0;
    tap.rightCursor = 0;
});

describe('LUFSMeter window lengths', () => {
    it('reads the three-second short-term window over programme, not over the frame cadence', () => {
        render(<LUFSMeter />);

        // Poll 0 ran on mount; 1 130 polls later the eighth silent block has
        // joined a window whose oldest block is still the last tone block.
        runFrames(1_130);

        expect(shortTermReading()).toBe('-32.0');
    });
});

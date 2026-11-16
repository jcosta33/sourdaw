import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransportClock, type TransportClockSnapshot } from '../createTransportClock';

/** Slot indices the worklet readers use (`worklets/kneadProcessor.ts`). */
const F64 = {
    beat: 0,
    tempo: 1,
    sampleRate: 2,
    loopStart: 3,
    loopEnd: 4,
    isPlaying: 5,
    isLooping: 6,
    positionSeconds: 8,
};
const SEQ_I32 = 14;

const SNAPSHOT: TransportClockSnapshot = {
    beat: 4.25,
    positionSeconds: 1.846,
    tempo: 130,
    isPlaying: true,
    loopStart: 1.5,
    loopEnd: 5.75,
    isLooping: true,
};

function requireBuffer(buffer: SharedArrayBuffer | null): SharedArrayBuffer {
    if (buffer === null) {
        throw new Error('expected the transport clock to hold a SharedArrayBuffer');
    }
    return buffer;
}

describe('createTransportClock', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('allocates the 72-byte buffer the worklet readers attach to', () => {
        const clock = createTransportClock({ readSampleRate: () => 48000 });

        expect(requireBuffer(clock.sharedBuffer()).byteLength).toBe(72);
    });

    it('writes each field into its named slot, with the sample rate from the port', () => {
        const clock = createTransportClock({ readSampleRate: () => 44100 });
        const value = new Float64Array(requireBuffer(clock.sharedBuffer()));

        clock.write(SNAPSHOT);

        expect({
            beat: value[F64.beat],
            tempo: value[F64.tempo],
            sampleRate: value[F64.sampleRate],
            loopStart: value[F64.loopStart],
            loopEnd: value[F64.loopEnd],
            isPlaying: value[F64.isPlaying],
            isLooping: value[F64.isLooping],
            positionSeconds: value[F64.positionSeconds],
        }).toEqual({
            beat: 4.25,
            tempo: 130,
            sampleRate: 44100,
            loopStart: 1.5,
            loopEnd: 5.75,
            isPlaying: 1,
            isLooping: 1,
            positionSeconds: 1.846,
        });
    });

    it('encodes stopped and not-looping as 0', () => {
        const clock = createTransportClock({ readSampleRate: () => 48000 });
        const value = new Float64Array(requireBuffer(clock.sharedBuffer()));

        clock.write(SNAPSHOT);
        clock.write({ ...SNAPSHOT, isPlaying: false, isLooping: false });

        expect([value[F64.isPlaying], value[F64.isLooping]]).toEqual([0, 0]);
    });

    it('reads the sample rate at each write, not once at construction', () => {
        let rate = 44100;
        const clock = createTransportClock({ readSampleRate: () => rate });
        const value = new Float64Array(requireBuffer(clock.sharedBuffer()));

        clock.write(SNAPSHOT);
        rate = 96000;
        clock.write(SNAPSHOT);

        expect(value[F64.sampleRate]).toBe(96000);
    });

    it('leaves the sequence counter even after a write and advances it by exactly 2', () => {
        const clock = createTransportClock({ readSampleRate: () => 48000 });
        const seq = new Int32Array(requireBuffer(clock.sharedBuffer()));

        const before = Atomics.load(seq, SEQ_I32);
        clock.write(SNAPSHOT);
        const afterFirst = Atomics.load(seq, SEQ_I32);
        clock.write(SNAPSHOT);
        const afterSecond = Atomics.load(seq, SEQ_I32);

        expect([before, afterFirst, afterSecond]).toEqual([0, 2, 4]);
    });

    it('holds the sequence counter odd while the field writes are in progress', () => {
        // The port runs between the field writes, so it observes the counter
        // exactly as a worklet reader sampling mid-write would.
        const observedSeq: number[] = [];
        let seq: Int32Array | null = null;
        const clock = createTransportClock({
            readSampleRate: () => {
                if (seq !== null) {
                    observedSeq.push(Atomics.load(seq, SEQ_I32));
                }
                return 48000;
            },
        });
        seq = new Int32Array(requireBuffer(clock.sharedBuffer()));

        clock.write(SNAPSHOT);
        clock.write(SNAPSHOT);

        expect(observedSeq).toEqual([1, 3]);
    });

    it('allocates nothing and writes nothing without SharedArrayBuffer', () => {
        vi.stubGlobal('SharedArrayBuffer', undefined);
        const readSampleRate = vi.fn(() => 48000);
        const clock = createTransportClock({ readSampleRate });

        expect(clock.sharedBuffer()).toBeNull();
        expect(() => clock.write(SNAPSHOT)).not.toThrow();
        expect(readSampleRate).not.toHaveBeenCalled();
    });

    it('drops the buffer on release so later writes no-op', () => {
        const readSampleRate = vi.fn(() => 48000);
        const clock = createTransportClock({ readSampleRate });
        const buffer = requireBuffer(clock.sharedBuffer());
        const value = new Float64Array(buffer);
        const seq = new Int32Array(buffer);
        clock.write(SNAPSHOT);
        readSampleRate.mockClear();

        clock.release();
        clock.write({ ...SNAPSHOT, beat: 99 });

        expect(clock.sharedBuffer()).toBeNull();
        expect(value[F64.beat]).toBe(4.25);
        expect(Atomics.load(seq, SEQ_I32)).toBe(2);
        expect(readSampleRate).not.toHaveBeenCalled();
    });
});

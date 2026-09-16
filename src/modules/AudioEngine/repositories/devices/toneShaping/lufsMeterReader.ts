import { type BuiltinLufsMeterReader, type BuiltinLufsMeterWindow } from '../../../models/BuiltinLufsMeterReader';

// ── LUFS meter reading state ─────────────────────────────────────────────
//
// The device graph K-weights the signal into an AnalyserNode; this reader
// turns the analyser's time-domain blocks into windowed loudness readings.
// Each `read()` consumes one block and feeds three accumulators:
// momentary (400 ms ring), short-term (3 s ring) and integrated (running
// energy average since the device was created, ungated).

const MOMENTARY_WINDOW_SEC = 0.4;
const SHORT_TERM_WINDOW_SEC = 3;

/** Standard LUFS offset from K-weighted mean square to the absolute scale. */
const LUFS_OFFSET_DB = -0.691;
/** Anything below this reads as digital silence on the meter. */
const LUFS_ABSOLUTE_FLOOR = -70;

const WINDOW_INDEX_TO_WINDOW: readonly BuiltinLufsMeterWindow[] = ['momentary', 'shortTerm', 'integrated'];
const WINDOW_COUNT = WINDOW_INDEX_TO_WINDOW.length;

type LoudnessRing = {
    powers: Float64Array;
    head: number;
    count: number;
};

function createLoudnessRing(blocks: number): LoudnessRing {
    return { powers: new Float64Array(Math.max(1, blocks)), head: 0, count: 0 };
}

function pushLoudnessBlock(ring: LoudnessRing, power: number): void {
    ring.powers[ring.head] = power;
    ring.head = (ring.head + 1) % ring.powers.length;
    ring.count = Math.min(ring.count + 1, ring.powers.length);
}

function ringLoudness(ring: LoudnessRing): number {
    if (ring.count === 0) {
        return LUFS_ABSOLUTE_FLOOR;
    }
    let sum = 0;
    for (let index = 0; index < ring.count; index++) {
        sum += ring.powers[index]!;
    }
    return lufsFromMeanSquare(sum / ring.count);
}

function lufsFromMeanSquare(meanSquare: number): number {
    if (meanSquare <= 0) {
        return LUFS_ABSOLUTE_FLOOR;
    }
    return Math.max(LUFS_ABSOLUTE_FLOOR, LUFS_OFFSET_DB + 10 * Math.log10(meanSquare));
}

type AnalyserLike = Pick<AnalyserNode, 'fftSize' | 'getFloatTimeDomainData'>;

export function createLufsMeterReader(analyser: AnalyserLike, sampleRate: number): BuiltinLufsMeterReader {
    const blockBuffer = new Float32Array(analyser.fftSize);
    const blockSec = analyser.fftSize / sampleRate;
    const momentaryRing = createLoudnessRing(Math.round(MOMENTARY_WINDOW_SEC / blockSec));
    const shortTermRing = createLoudnessRing(Math.round(SHORT_TERM_WINDOW_SEC / blockSec));
    let integratedPowerSum = 0;
    let integratedBlockCount = 0;
    let selectedWindowIndex = 0;

    return {
        read: () => {
            analyser.getFloatTimeDomainData(blockBuffer);
            let sumSquares = 0;
            for (let index = 0; index < blockBuffer.length; index++) {
                const sample = blockBuffer[index]!;
                sumSquares += sample * sample;
            }
            const meanSquare = sumSquares / blockBuffer.length;
            pushLoudnessBlock(momentaryRing, meanSquare);
            pushLoudnessBlock(shortTermRing, meanSquare);
            integratedPowerSum += meanSquare;
            integratedBlockCount += 1;
            const momentary = ringLoudness(momentaryRing);
            const shortTerm = ringLoudness(shortTermRing);
            const integrated = lufsFromMeanSquare(integratedPowerSum / integratedBlockCount);
            const readings: Record<BuiltinLufsMeterWindow, number> = { momentary, shortTerm, integrated };
            const window = WINDOW_INDEX_TO_WINDOW[selectedWindowIndex]!;
            return { window, value: readings[window], ...readings };
        },
        setWindow: (windowIndex: number) => {
            selectedWindowIndex = Math.min(WINDOW_COUNT - 1, Math.max(0, Math.round(windowIndex)));
        },
        window: () => WINDOW_INDEX_TO_WINDOW[selectedWindowIndex]!,
    };
}

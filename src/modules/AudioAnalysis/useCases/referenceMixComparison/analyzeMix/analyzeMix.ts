import { type MixAnalysis } from '../../../models/MixComparisonTypes';

import { measureProgramAudio } from './measureProgramAudio';

/**
 * The result of measuring the current mix. A measurement only exists when the
 * caller supplied program audio; estimating levels from track layout fabricated
 * loudness advice for tracks that never emitted a sample.
 */
export type CurrentMixMeasurement =
    | { status: 'measured'; analysis: MixAnalysis; source: 'program-audio'; measuredAt: number }
    | { status: 'unavailable'; reason: 'no-program-audio' | 'silent-program-audio' };

/**
 * Analyze the current mix from explicit program audio. Pass the retained mix
 * render (or the track buffers that make it up); with no audio, or audio that
 * is pure silence, the result says so instead of producing numbers.
 */
export function analyzeMix(programAudio?: readonly AudioBuffer[]): CurrentMixMeasurement {
    if (!programAudio || programAudio.length === 0) {
        return { status: 'unavailable', reason: 'no-program-audio' };
    }

    const measurement = measureProgramAudio(programAudio);
    if (measurement === null) {
        return { status: 'unavailable', reason: 'silent-program-audio' };
    }

    return { status: 'measured', analysis: measurement, source: 'program-audio', measuredAt: Date.now() };
}

import { type MixComparisonResult } from '../../models/MixComparisonTypes';

import { analyzeMix } from './analyzeMix/analyzeMix';
import { createReferenceAnalysis } from './analyzeMix/createReferenceAnalysis';
import { compareMixes } from './compareMixes';

/** Why a comparison could not produce a measured score. */
export type MixComparisonUnavailable = {
    status: 'unavailable';
    reason: 'no-program-audio' | 'silent-program-audio';
};

/**
 * Compare the current mix against a reference.
 *
 * The current side is always a measurement of the program audio the caller
 * supplies; without it there is no score. The reference is the built-in
 * mastered-mix target — a deliberately specified style goal, not a measured
 * recording, and the result labels it as such.
 */
export function compareToReference(
    programAudio?: readonly AudioBuffer[]
): MixComparisonResult | MixComparisonUnavailable {
    const current = analyzeMix(programAudio);
    if (current.status === 'unavailable') {
        return { status: 'unavailable', reason: current.reason };
    }

    const reference = createReferenceAnalysis();
    return {
        ...compareMixes(reference, current.analysis),
        referenceKind: 'specified-target',
    };
}

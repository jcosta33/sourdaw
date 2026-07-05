import { type MixComparisonResult } from '../../models/MixComparisonTypes';

import { analyzeMix } from './analyzeMix/analyzeMix';
import { createReferenceAnalysis } from './analyzeMix/createReferenceAnalysis';
import { compareMixes } from './compareMixes';

/**
 * Run full comparison against a default mastered reference.
 */
export function compareToReference(): MixComparisonResult {
    const current = analyzeMix();
    const reference = createReferenceAnalysis();
    return compareMixes(reference, current);
}

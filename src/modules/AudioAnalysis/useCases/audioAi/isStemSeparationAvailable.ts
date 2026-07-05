import { isStemSeparationAvailable as checkStemSeparationAvailability } from '../../repositories/isStemSeparationAvailable';

/**
 * Public contract for AudioAnalysis AI engine operations.
 */
export function isStemSeparationAvailable(): boolean {
    return checkStemSeparationAvailability();
}

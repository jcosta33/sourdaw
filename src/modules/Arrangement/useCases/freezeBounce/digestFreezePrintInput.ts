import { describeSubgraphPrintInput } from '#/modules/AudioEngine/useCases';
import { digest } from '#/utils/canonicalDigest';

import { createTrackFreezeSourceSignature } from '../../services/createTrackFreezeSourceSignature';

import { type FreezePrintInput } from './selectFreezePrintInput';

/**
 * A freeze's source signature: the canonical digest of the input its render prints. Each track's
 * clips and chain sign through the track's own freeze source signature, which already folds the
 * defaults the render reads an absent field as.
 *
 * A freeze made before the signature covered the whole render input carries a different digest,
 * single-track freezes included: staleness detection never compares a first sighting, so such a
 * freeze stays frozen until its sources change, and then goes stale.
 */
export function digestFreezePrintInput(input: FreezePrintInput): string {
    return digest(describeSubgraphPrintInput(input, createTrackFreezeSourceSignature));
}

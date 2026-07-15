import { tauriInvoke } from '#/utils/tauriBridge';

import { ensureTauri } from './helpers';

import type { OnsetAlgorithm, OnsetDetectionResult } from '../../models/CrumbsTypes';

export async function detectOnsets(
    instanceId: string,
    sampleId: number,
    algorithm: OnsetAlgorithm
): Promise<OnsetDetectionResult> {
    ensureTauri('detect_onsets');
    const result = await tauriInvoke('detect_onsets', { instanceId, sampleId, algorithm });
    return result as OnsetDetectionResult;
}

import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureNative } from './helpers';

import type { OnsetAlgorithm, OnsetDetectionResult } from '../../models/CrumbsTypes';

export async function detectOnsets(
    instanceId: string,
    sampleId: number,
    algorithm: OnsetAlgorithm
): Promise<OnsetDetectionResult> {
    ensureNative('detect_onsets');
    const result = await desktopInvoke('detect_onsets', { instanceId, sampleId, algorithm });
    return result as OnsetDetectionResult;
}

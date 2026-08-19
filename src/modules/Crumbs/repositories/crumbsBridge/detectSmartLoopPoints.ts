import { desktopInvoke } from '#/utils/desktopBridge';

import { ensureNative } from './helpers';

import type { LoopPointDetectionResult } from '../../models/CrumbsTypes';

export async function detectSmartLoopPoints(
    instanceId: string,
    sampleId: number
): Promise<LoopPointDetectionResult | null> {
    ensureNative('detect_smart_loop_points');
    const result = await desktopInvoke('detect_smart_loop_points', { instanceId, sampleId });
    return result as LoopPointDetectionResult | null;
}

import { ensureTauri } from './helpers';
import { invokeCrumbs } from './invokeCrumbs';

import type { LoopPointDetectionResult } from '../../models/CrumbsTypes';

export async function detectSmartLoopPoints(
    instanceId: string,
    sampleId: number
): Promise<LoopPointDetectionResult | null> {
    ensureTauri('detect_smart_loop_points');
    const result = await invokeCrumbs('detect_smart_loop_points', { instanceId, sampleId });
    return result as LoopPointDetectionResult | null;
}

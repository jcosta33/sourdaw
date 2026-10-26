import { runAllEffects } from '#/utils/runEffects';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { clearAllReportedLatency } from '../latencyCompensation/compensation/externalLatencyRegistry';

export function resetAudioGraph(): void {
    runAllEffects([() => audioEngine.resetGraph(), clearAllReportedLatency]);
}

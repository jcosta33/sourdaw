import { inject } from '#/infra/di/inject';
import { runAllEffects } from '#/utils/runEffects';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { clearAllReportedLatency } from '../latencyCompensation/compensation/externalLatencyRegistry';

export const resetAudioGraph = inject({ audioEngine })(
    ({ audioEngine }) =>
        function resetAudioGraph(): void {
            runAllEffects([() => audioEngine.resetGraph(), clearAllReportedLatency]);
        }
);

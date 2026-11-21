import { inject } from '#/infra/di/inject';

import { type RuntimeGraphDeltaNode } from '../models/RuntimeGraphDelta';
import { audioEngine } from '../repositories/createWebAudioEngine';
import { matchesRuntimeDeviceChainTopology as matchesTopology } from '../services/matchesRuntimeDeviceChainTopology';

/** Whether one project-owned device topology is already exact in the live graph. */
export const matchesRuntimeDeviceChainTopology = inject({ audioEngine })(
    ({ audioEngine }) =>
        function matchesRuntimeDeviceChainTopology(expected: RuntimeGraphDeltaNode): boolean {
            return matchesTopology(audioEngine.getTrackStrip(expected.id), expected);
        }
);

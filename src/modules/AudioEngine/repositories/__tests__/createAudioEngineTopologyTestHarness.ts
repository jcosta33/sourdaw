import { createAudioEngine, type AudioEngineTopologyTestHarness } from '../createWebAudioEngine';

/** Test-only helper keeps raw topology fixtures outside the production barrel. */
export function createAudioEngineTopologyTestHarness(providedContext?: AudioContext): AudioEngineTopologyTestHarness {
    return createAudioEngine(providedContext, { topologyTestHarness: true });
}

export type { AudioEngineTopologyTestHarness };

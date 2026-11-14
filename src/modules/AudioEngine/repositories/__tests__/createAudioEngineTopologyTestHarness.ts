import { composeWebAudioEngine, type WebAudioEngineInternals } from '../createWebAudioEngine';

import type { AudioEngine } from '../../models/AudioEngineState';

/** The engine itself, carrying its internals and the raw device primitives the topology fixtures drive. */
export type AudioEngineTopologyTestHarness = AudioEngine &
    Pick<WebAudioEngineInternals, 'addDeviceToStrip' | 'removeDeviceFromStrip'> & {
        readonly internals: WebAudioEngineInternals;
    };

/**
 * Test-only helper keeps raw topology fixtures outside the production barrel.
 * It returns the engine object itself rather than a copy, so field writes,
 * getters and `vi.spyOn` on the harness reach the engine.
 */
export function createAudioEngineTopologyTestHarness(providedContext?: AudioContext): AudioEngineTopologyTestHarness {
    const { engine, internals } = composeWebAudioEngine(providedContext);
    return Object.assign(engine, {
        internals,
        addDeviceToStrip: internals.addDeviceToStrip,
        removeDeviceFromStrip: internals.removeDeviceFromStrip,
    });
}

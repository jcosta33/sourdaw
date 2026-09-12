import { controlRoomStore } from '#/modules/ControlRoom/stores';
import { dbToGain } from '#/utils/audioLevelLaw';

import { type AudioEngine } from '../../models/AudioEngineState';
import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Realise the ControlRoom store's monitoring state on the listening path.
 *
 * The store is the truth (the toggles only write it); this is the execution
 * consumer that makes the gestures audible. Dim is a listening attenuation of
 * the store's own `dimLevel`, so the value never lives here — a monitoring
 * choice must never reach the programme, and this is the only writer of the
 * engine's monitoring insert, which sits strictly downstream of the fader and
 * the meters.
 */
function applyControlRoomMonitoring(engine: AudioEngine): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    engine.setControlRoomMonitoring({
        monoActive: state.monoActive,
        dimGain: state.dimActive ? dbToGain(state.dimLevel) : 1,
    });
}

/**
 * Subscribe the listening path to the ControlRoom store, applying the state
 * held at setup first — a toggle made before the app finished booting must not
 * wait for a second one. Returns the unsubscribe, like every other engine sync.
 *
 * The engine is named rather than captured so the app's one carrier is the
 * default, not an assumption: the app wiring passes nothing, and a graph
 * fixture passes the engine it built.
 */
export function syncControlRoomMonitoring(engine: AudioEngine = audioEngine): () => void {
    applyControlRoomMonitoring(engine);
    return controlRoomStore.subscribe(() => applyControlRoomMonitoring(engine));
}

import { setControlRoomMonitoring } from '#/modules/AudioEngine/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { controlRoomStore } from '../../stores/controlRoom';

type ApplyListeningPathMonitoring = typeof setControlRoomMonitoring;

/**
 * Realise the ControlRoom store's monitoring state on the listening path.
 *
 * The store is the truth (the toggles only write it); this is the execution
 * consumer that makes the gestures audible. Dim is a listening attenuation of
 * the store's own `dimLevel`, so the value never lives in the engine — a
 * monitoring choice must never reach the programme, and this is the only
 * writer of the engine's monitoring insert.
 */
function applyControlRoomMonitoring(applyToListeningPath: ApplyListeningPathMonitoring): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    applyToListeningPath({
        monoActive: state.monoActive,
        dimGain: state.dimActive ? dbToGain(state.dimLevel) : 1,
    });
}

/**
 * Subscribe the listening path to the ControlRoom store, applying the state
 * held at setup first — a toggle made before the app finished booting must not
 * wait for a second one. Returns the unsubscribe, like every other engine sync.
 *
 * The listening path is named rather than captured so the app's one engine is
 * the default, not an assumption: the app wiring passes nothing, and a graph
 * fixture passes the engine it built.
 */
export function syncControlRoomMonitoring(
    applyToListeningPath: ApplyListeningPathMonitoring = setControlRoomMonitoring
): () => void {
    applyControlRoomMonitoring(applyToListeningPath);
    return controlRoomStore.subscribe(() => applyControlRoomMonitoring(applyToListeningPath));
}

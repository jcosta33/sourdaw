import { getNextLayerId } from '../../repositories/loopStationIdCounter/getNextLayerId';
import { loopStationStore, type LoopLayer } from '../../stores/loopStationStore';

export function toggleRecord(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }

    loopStationStore.set({
        ...state,
        slots: state.slots.map((state1) => {
            if (state1.id !== slotId) {
                return state1;
            }

            switch (state1.state) {
                case 'empty':
                    return { ...state1, state: 'recording' as const };
                case 'recording': {
                    const layer: LoopLayer = {
                        id: getNextLayerId(),
                        layerIndex: 0,
                        recordedAt: new Date().toISOString(),
                        muted: false,
                        volume: 1,
                    };
                    return {
                        ...state1,
                        state: 'playing' as const,
                        layers: [layer],
                        lengthBeats: state.fixedLoopLength || 4,
                    };
                }
                case 'playing':
                    return { ...state1, state: 'overdubbing' as const };
                case 'overdubbing': {
                    const newLayer: LoopLayer = {
                        id: getNextLayerId(),
                        layerIndex: state1.layers.length,
                        recordedAt: new Date().toISOString(),
                        muted: false,
                        volume: 1,
                    };
                    return { ...state1, state: 'playing' as const, layers: [...state1.layers, newLayer] };
                }
                case 'stopped':
                    // A slot stopped mid-first-recording (stopSlot maps any state to
                    // 'stopped' unconditionally) has zero layers. Resuming that to
                    // 'playing' would light a cell with nothing to play — mirror
                    // triggerSlot's no-op guard instead.
                    if (state1.layers.length === 0) {
                        return state1;
                    }
                    return { ...state1, state: 'playing' as const };
                default:
                    return state1;
            }
        }),
    });
}

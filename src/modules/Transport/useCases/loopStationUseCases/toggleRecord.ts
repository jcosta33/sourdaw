import { loopStationStore, type LoopLayer } from '#/modules/Transport/stores/loopStationStore';
import { getNextLayerId } from '#/modules/Transport/helpers/loopStationHelpers';

export function toggleRecord(slotId: string): void {
    const state = loopStationStore.value;
    if (!state) {
        return;
    }

    loopStationStore.set({
        ...state,
        slots: state.slots.map((s) => {
            if (s.id !== slotId) {
                return s;
            }

            switch (s.state) {
                case 'empty':
                    return { ...s, state: 'recording' as const };
                case 'recording': {
                    const layer: LoopLayer = {
                        id: getNextLayerId(), layerIndex: 0,
                        recordedAt: new Date().toISOString(), muted: false, volume: 1,
                    };
                    return {
                        ...s, state: 'playing' as const, layers: [layer],
                        lengthBeats: state.fixedLoopLength || 4,
                    };
                }
                case 'playing':
                    return { ...s, state: 'overdubbing' as const };
                case 'overdubbing': {
                    const newLayer: LoopLayer = {
                        id: getNextLayerId(), layerIndex: s.layers.length,
                        recordedAt: new Date().toISOString(), muted: false, volume: 1,
                    };
                    return { ...s, state: 'playing' as const, layers: [...s.layers, newLayer] };
                }
                case 'stopped':
                    return { ...s, state: 'playing' as const };
                default:
                    return s;
            }
        }),
    });
}

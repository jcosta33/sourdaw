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
                    // A 'stopped' slot holding zero layers is behaviourally
                    // 'empty' — nothing was ever committed — so Record starts a
                    // recording, same as the 'empty' case. `stopSlot` no longer
                    // produces that shape (a zero-layer slot always returns to
                    // 'empty' there), but persisted or restored state can still
                    // carry it, and promoting it to 'playing' would light a
                    // Play cell with nothing to play. Returning it
                    // unchanged would strand the slot instead: Record has no
                    // disabled guard (unlike Play/Undo, which both gate on
                    // layers.length === 0), so every future press would be a
                    // silent no-op with only Clear able to recover it.
                    if (state1.layers.length === 0) {
                        return { ...state1, state: 'recording' as const };
                    }
                    return { ...state1, state: 'playing' as const };
                default:
                    return state1;
            }
        }),
    });
}

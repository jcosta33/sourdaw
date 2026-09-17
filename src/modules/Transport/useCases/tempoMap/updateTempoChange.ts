import { MAX_TEMPO_MAP_TEMPO, MIN_TEMPO_MAP_TEMPO } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

export function updateTempoChange(changeId: string, tempo: number): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }
    tempoMapStore.set({
        changes: state.changes.map((context) => {
            if (context.id !== changeId) {
                return context;
            }
            return { ...context, tempo: Math.max(MIN_TEMPO_MAP_TEMPO, Math.min(MAX_TEMPO_MAP_TEMPO, tempo)) };
        }),
    });
}

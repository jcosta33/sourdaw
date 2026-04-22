import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

export function updateModulator(id: string, patch: Partial<Modulator>): void {
    const state = modulationStore.value;
    if (!state) {
        return;
    }
    modulationStore.set({
        modulators: state.modulators.map((m) => (m.id === id ? { ...m, ...patch, id: m.id } : m)),
    });
}

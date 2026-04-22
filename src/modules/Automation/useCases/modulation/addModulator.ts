import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

export function addModulator(modulator: Omit<Modulator, 'id'>): string {
    const id = `mod-${modulator.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const state = modulationStore.value ?? { modulators: [] };
    modulationStore.set({
        modulators: [...state.modulators, { ...modulator, id }],
    });
    return id;
}

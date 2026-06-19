import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

export function addModulator(modulator: Omit<Modulator, 'id'>): string {
    // The kind discriminator is duplicated on `Modulator.kind` and `config.kind`
    // (the UI labels on the former, the engine computes on the latter). They must
    // agree or the modulator is internally inconsistent (e.g. labelled "Envelope"
    // while the engine evaluates it as an LFO).
    if (modulator.config.kind !== modulator.kind) {
        throw new Error(
            `addModulator: kind mismatch — modulator.kind="${modulator.kind}" but config.kind="${modulator.config.kind}"`
        );
    }
    // A modulator with no owning track can never resolve its bindings
    // (`resolveBinding` returns null), so it would be a permanent dead entry.
    if (modulator.trackId === '') {
        throw new Error('addModulator: trackId must not be empty');
    }

    const id = `mod-${modulator.kind}-${crypto.randomUUID().slice(0, 8)}`;
    const state = modulationStore.value ?? { modulators: [] };
    modulationStore.set({
        modulators: [...state.modulators, { ...modulator, id }],
    });
    return id;
}

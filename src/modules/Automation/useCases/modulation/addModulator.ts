import { type Modulator } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

/** `modulatorId` pins the new modulator's identity so a dispatched action replays
 *  to the same modulator everywhere (the action's inverse removes exactly that id). */
export function addModulator(modulator: Omit<Modulator, 'id'>, modulatorId?: string): string {
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

    // Use the full UUID (not a 32-bit truncation) so ids stay unique across a
    // persisted/merged project regardless of how many modulators it accumulates.
    const id = modulatorId ?? `mod-${modulator.kind}-${crypto.randomUUID()}`;
    const state = modulationStore.value ?? { modulators: [] };
    modulationStore.set({
        modulators: [...state.modulators, { ...modulator, id }],
    });
    return id;
}

import { modulationStore, sanitize_modulation_store_state } from '../../stores/modulationStore';

/**
 * Load persisted modulators into the live store, replacing whatever the
 * previous project left there.
 *
 * The store's own sanitizer is the decoder, so a project file and a CRDT
 * document are held to exactly one definition of a valid modulator. An absent
 * or undecodable value sanitizes to the empty default, which clears the
 * outgoing project's modulators rather than leaving them mapped at parameters
 * of tracks that no longer exist.
 */
export function hydrateModulationState(persistedModulation: unknown): void {
    modulationStore.set(sanitize_modulation_store_state(persistedModulation));
}

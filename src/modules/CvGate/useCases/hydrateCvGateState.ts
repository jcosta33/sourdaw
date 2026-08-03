import { cvGateStore, sanitize_cv_gate_state } from '../stores/cvGate';

/**
 * Load persisted CV/gate outputs into the live store, replacing whatever the
 * previous project left there.
 *
 * The store's own sanitizer is the decoder, so a project file and a CRDT
 * document are held to exactly one definition of a valid output channel. An
 * absent or undecodable value sanitizes to the empty default rather than
 * leaving the outgoing project's outputs driving hardware channels.
 */
export function hydrateCvGateState(persistedCvGate: unknown): void {
    cvGateStore.set(sanitize_cv_gate_state(persistedCvGate));
}

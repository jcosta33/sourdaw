import { sidechainStore } from '../stores/sidechainStore';

/**
 * Hydrates the sidechain store from its underlying persistent storage.
 *
 * CrdtDocument calls `sidechainStore.hydrate()` directly for bootstrapping.
 * This use case wraps that call so the intent is explicit at the use-case layer
 * and can be referenced or replaced without touching store internals.
 */
export function hydrateSidechainRoutes(): void {
    sidechainStore.hydrate();
}

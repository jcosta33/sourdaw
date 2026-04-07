// Legacy file — no longer used by createStore.
// Kept to avoid file deletion; will be removed when cleanup is done.
import { storeRegistry } from './storeRegistry';

export const getController = <TSnapshot>(store: object): { set: (next: TSnapshot) => void; update: (updater: (prev: TSnapshot) => TSnapshot) => void } => {
    const controller = storeRegistry.get(store);
    if (!controller) {
        throw new Error('Store controller not found for the given store.');
    }
    return controller as { set: (next: TSnapshot) => void; update: (updater: (prev: TSnapshot) => TSnapshot) => void };
};

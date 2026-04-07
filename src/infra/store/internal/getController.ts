import { Store, StoreController } from '../types';
import { storeRegistry } from './storeRegistry';

export const getController = <TSnapshot>(store: Store<TSnapshot>): StoreController<TSnapshot> => {
    const controller = storeRegistry.get(store);
    if (!controller) {
        throw new Error('Store controller not found for the given store.');
    }
    return controller;
};

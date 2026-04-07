import { Store, StoreController } from '../types';

export const storeRegistry = new WeakMap<Store<any>, StoreController<any>>();

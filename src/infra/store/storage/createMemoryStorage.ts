import { type StorageAdapter } from './types';

export const createMemoryStorage = <TData>(): StorageAdapter<TData> => {
    let value: TData | null = null;

    return {
        get: () => value,
        set: (next: TData | null) => {
            value = next;
        },
        clear: () => {
            value = null;
        },
        isSupported: () => true,
    };
};

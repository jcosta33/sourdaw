import type { DependencyKey } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DI registry maps are heterogeneous by design
export const registrations = new Map<DependencyKey<any>, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DI factory cache holds heterogeneous callable types
export const cache = new Map<any, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DI test override maps hold heterogeneous types
export const testOverrides = new Map<any, any>();

export const resetContainerState = () => {
    registrations.clear();
    cache.clear();
    testOverrides.clear();
};

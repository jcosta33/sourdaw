import type { DependencyKey } from '../types';

export const registrations = new Map<DependencyKey<any>, any>();
export const cache = new Map<any, any>();
export const testOverrides = new Map<any, any>();

export const resetContainerState = () => {
    registrations.clear();
    cache.clear();
    testOverrides.clear();
};
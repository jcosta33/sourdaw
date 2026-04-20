import { registrations, resetContainerState } from './internal/containerState';

import type { ContainerApi, DependencyKey } from './types';

export const Container: ContainerApi = {
    register<TValue>(token: DependencyKey<TValue>, value: TValue): void {
        if (registrations.has(token)) {
            throw new Error(`Token already registered: ${String(token)}`);
        }
        registrations.set(token, value);
    },
    set<TValue>(token: DependencyKey<TValue>, value: TValue): void {
        registrations.set(token, value);
    },
    get<TValue>(token: DependencyKey<TValue>): TValue {
        if (!registrations.has(token)) {
            throw new Error(`Token not registered: ${String(token)}`);
        }
        return registrations.get(token) as TValue;
    },
    clear(): void {
        resetContainerState();
    },
};

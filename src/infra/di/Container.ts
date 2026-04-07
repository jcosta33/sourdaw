import type { ContainerApi, DependencyKey } from './types';
import { registrations, resetContainerState } from './internal/containerState';

export const Container: ContainerApi = {
    register<T>(token: DependencyKey<T>, value: T): void {
        if (registrations.has(token)) {
            throw new Error(`Token already registered: ${String(token)}`);
        }
        registrations.set(token, value);
    },
    set<T>(token: DependencyKey<T>, value: T): void {
        registrations.set(token, value);
    },
    get<T>(token: DependencyKey<T>): T {
        if (!registrations.has(token)) {
            throw new Error(`Token not registered: ${String(token)}`);
        }
        return registrations.get(token) as T;
    },
    clear(): void {
        resetContainerState();
    },
};
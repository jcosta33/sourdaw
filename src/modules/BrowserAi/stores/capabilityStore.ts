/**
 * Store for browser AI capability detection state.
 */

import { createStore } from '#/infra/store/createStore';
import { type CapabilityReport } from '../models/CapabilityReport';

export type CapabilityState =
    | { phase: 'idle' }
    | { phase: 'detecting' }
    | { phase: 'done'; report: CapabilityReport }
    | { phase: 'error'; message: string };

export const capabilityStore = createStore<CapabilityState>({
    initialData: { phase: 'idle' },
});

export function setCapabilityDetecting(): void {
    capabilityStore.set({ phase: 'detecting' });
}

export function setCapabilityReport(report: CapabilityReport): void {
    capabilityStore.set({ phase: 'done', report });
}

export function setCapabilityError(message: string): void {
    capabilityStore.set({ phase: 'error', message });
}

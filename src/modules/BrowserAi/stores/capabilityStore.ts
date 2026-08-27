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

export type CapabilityProbeAttempt = { readonly id: number };

let latestCapabilityProbeId = 0;

export const capabilityStore = createStore<CapabilityState>({
    initialData: { phase: 'idle' },
});

export function isWebGpuAvailable(): boolean {
    const capabilityState = capabilityStore.value;
    return capabilityState?.phase === 'done' && capabilityState.report.webGpu.status === 'supported';
}

export function beginCapabilityDetection(): CapabilityProbeAttempt {
    const attempt = { id: ++latestCapabilityProbeId };
    capabilityStore.set({ phase: 'detecting' });
    return attempt;
}

export function settleCapabilityReport(attempt: CapabilityProbeAttempt, report: CapabilityReport): void {
    if (attempt.id !== latestCapabilityProbeId) {
        return;
    }
    capabilityStore.set({ phase: 'done', report });
}

export function settleCapabilityError(attempt: CapabilityProbeAttempt, message: string): void {
    if (attempt.id !== latestCapabilityProbeId) {
        return;
    }
    capabilityStore.set({ phase: 'error', message });
}

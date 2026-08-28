import { type AgentRunPendingEffect } from './AgentRun';

export function getPendingEffectRecoveryPolicy(effects: readonly AgentRunPendingEffect[]): {
    recovery: 'manual-repair' | 'reconcile-batch';
    reason: string | null;
} {
    if (effects.some(({ operation }) => operation === 'renderProjectSections')) {
        return {
            recovery: 'manual-repair',
            reason: 'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.',
        };
    }
    if (effects.some(({ remediation }) => remediation === 'manual-repair')) {
        return {
            recovery: 'manual-repair',
            reason: 'At least one retained external effect requires manual repair and cannot be retried exactly.',
        };
    }
    return { recovery: 'reconcile-batch', reason: null };
}

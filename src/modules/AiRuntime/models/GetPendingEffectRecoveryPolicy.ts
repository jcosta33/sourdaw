import { type AgentRunPendingEffect } from './AgentRun';

export const MISSING_EXACT_CHECKPOINT_RECOVERY_REASON =
    'Pending project checkpoint recovery requires exact post-commit project revision evidence.';

export function getPendingEffectRecoveryPolicy(effects: readonly AgentRunPendingEffect[]): {
    recovery: 'manual-repair' | 'reconcile-batch';
    reason: string | null;
} {
    if (effects.some((effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections')) {
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
    if (effects.length > 0) {
        return {
            recovery: 'manual-repair',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        };
    }
    return { recovery: 'reconcile-batch', reason: null };
}

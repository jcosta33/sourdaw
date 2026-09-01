import { type AgentRunPendingEffect } from './AgentRun';

export const MISSING_EXACT_CHECKPOINT_RECOVERY_REASON =
    'Pending project checkpoint recovery requires exact post-commit project revision evidence.';

export const GENERIC_SECTION_RENDER_RECOVERY_REASON =
    'Generic pending-effect recovery cannot execute receipt-bound section renders. The original confirmation is required and may be unavailable after reload.';

type PendingEffectRecoveryPolicyOptions = {
    sourceRevision?: string;
};

export function getPendingEffectRecoveryPolicy(
    effects: readonly AgentRunPendingEffect[],
    options?: PendingEffectRecoveryPolicyOptions
): {
    recovery: 'manual-repair' | 'reconcile-batch';
    reason: string | null;
} {
    const hasSectionRender = effects.some(
        (effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections'
    );
    if (hasSectionRender && options?.sourceRevision === undefined) {
        return {
            recovery: 'manual-repair',
            reason: GENERIC_SECTION_RENDER_RECOVERY_REASON,
        };
    }
    if (effects.some(({ remediation }) => remediation === 'manual-repair')) {
        return {
            recovery: 'manual-repair',
            reason: 'At least one retained external effect requires manual repair and cannot be retried exactly.',
        };
    }
    if (effects.length > 0 && options?.sourceRevision === undefined) {
        return {
            recovery: 'manual-repair',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        };
    }
    return { recovery: 'reconcile-batch', reason: null };
}

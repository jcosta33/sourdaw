import { describe, expect, it } from 'vitest';

import { type AgentRunPendingEffect } from '../AgentRun';
import {
    GENERIC_SECTION_RENDER_RECOVERY_REASON,
    getPendingEffectRecoveryPolicy,
    MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
} from '../GetPendingEffectRecoveryPolicy';

function createExternalEffect(operation: string): AgentRunPendingEffect {
    return {
        commandId: `command-${operation}`,
        kind: 'external-effect',
        operation,
        reason: 'pending',
        remediation: 'reconcile',
        state: 'pending',
    };
}

describe('getPendingEffectRecoveryPolicy', () => {
    const genericEffect = createExternalEffect('setTrackGain');
    const renderEffect = createExternalEffect('renderProjectSections');

    it('requires exact checkpoint revision before generic pending effects can reconcile', () => {
        expect(getPendingEffectRecoveryPolicy([genericEffect])).toEqual({
            recovery: 'manual-repair',
            reason: MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
        });
    });

    it('refuses generic recovery of section renders until their source revision is bound', () => {
        expect(getPendingEffectRecoveryPolicy([renderEffect])).toEqual({
            recovery: 'manual-repair',
            reason: GENERIC_SECTION_RENDER_RECOVERY_REASON,
        });
    });

    it('admits exact-batch recovery when the post-commit source revision is bound', () => {
        expect(getPendingEffectRecoveryPolicy([genericEffect], { sourceRevision: 'revision-1' })).toEqual({
            recovery: 'reconcile-batch',
            reason: null,
        });
        expect(getPendingEffectRecoveryPolicy([renderEffect], { sourceRevision: 'revision-1' })).toEqual({
            recovery: 'reconcile-batch',
            reason: null,
        });
    });
});

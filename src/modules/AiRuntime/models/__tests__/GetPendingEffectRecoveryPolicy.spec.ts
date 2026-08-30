import { describe, expect, it } from 'vitest';

import { type AgentRunPendingEffect } from '../AgentRun';
import {
    GENERIC_SECTION_RENDER_RECOVERY_REASON,
    getPendingEffectRecoveryPolicy,
    MISSING_EXACT_CHECKPOINT_RECOVERY_REASON,
} from '../GetPendingEffectRecoveryPolicy';

function createEffect(input: Pick<AgentRunPendingEffect, 'kind' | 'operation' | 'remediation'>): AgentRunPendingEffect {
    return {
        commandId: `command-${input.operation}`,
        kind: input.kind,
        operation: input.operation,
        reason: 'pending',
        remediation: input.remediation,
        state: 'pending',
    };
}

describe('getPendingEffectRecoveryPolicy', () => {
    const genericEffect = createEffect({
        kind: 'external-effect',
        operation: 'setTrackGain',
        remediation: 'reconcile',
    });
    const renderEffect = createEffect({
        kind: 'external-effect',
        operation: 'renderProjectSections',
        remediation: 'reconcile',
    });

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

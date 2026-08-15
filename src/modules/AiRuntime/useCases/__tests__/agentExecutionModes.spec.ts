import { describe, expect, it } from 'vitest';

import { AGENT_EXECUTION_MODES } from '../../models/AgentExecutionMode';
import { getAgentExecutionModeAuthority } from '../getAgentExecutionModeAuthority';
import { getAgentExecutionModeFailure } from '../getAgentExecutionModeFailure';
import { resolveAgentExecutionMode } from '../resolveAgentExecutionMode';

describe('agent execution modes', () => {
    it('exposes only explain, plan, preview, apply, and macro', () => {
        expect(AGENT_EXECUTION_MODES).toEqual(['explain', 'plan', 'preview', 'apply', 'macro']);
        expect(AGENT_EXECUTION_MODES).not.toContain('autopilot');
    });

    it('starts legacy chat read-only and legacy prompt interactions in apply mode', () => {
        expect(resolveAgentExecutionMode({ chatMode: 'chat' })).toBe('explain');
        expect(resolveAgentExecutionMode({ chatMode: 'prompt' })).toBe('apply');
        expect(resolveAgentExecutionMode({ chatMode: 'chat', requestedMode: 'preview' })).toBe('preview');
        expect(() => resolveAgentExecutionMode({ chatMode: 'prompt', requestedMode: 'autopilot' })).toThrow(
            'Unsupported agent execution mode'
        );
    });

    it('keeps read, planning, preview, and commit authority separate', () => {
        expect(getAgentExecutionModeAuthority('explain')).toEqual({
            canCommit: false,
            canPlan: false,
            canPreview: false,
            requiresPolicyApproval: false,
            returnsReceipt: false,
        });
        expect(getAgentExecutionModeAuthority('plan')).toEqual({
            canCommit: false,
            canPlan: true,
            canPreview: false,
            requiresPolicyApproval: false,
            returnsReceipt: false,
        });
        expect(getAgentExecutionModeAuthority('preview')).toEqual({
            canCommit: false,
            canPlan: true,
            canPreview: true,
            requiresPolicyApproval: true,
            returnsReceipt: false,
        });
        for (const mode of ['apply', 'macro'] as const) {
            expect(getAgentExecutionModeAuthority(mode)).toEqual({
                canCommit: true,
                canPlan: true,
                canPreview: false,
                requiresPolicyApproval: true,
                returnsReceipt: true,
            });
        }
    });

    it('applies the trust ceiling independently from the selected interaction mode', () => {
        expect(
            getAgentExecutionModeFailure({
                mode: 'apply',
                operation: 'commit',
                requiredTrustMode: 'replace-selection',
                trustCeiling: 'apply-reversible',
            })
        ).toBe('Required trust mode replace-selection exceeds the apply-reversible ceiling');
        expect(
            getAgentExecutionModeFailure({
                mode: 'apply',
                operation: 'commit',
                requiredTrustMode: 'apply-reversible',
                trustCeiling: 'apply-reversible',
            })
        ).toBeNull();
        expect(
            getAgentExecutionModeFailure({
                mode: 'preview',
                operation: 'commit',
                requiredTrustMode: 'analyze-only',
                trustCeiling: 'destructive-commit',
            })
        ).toBe('Agent execution mode preview cannot commit actions');
        expect(
            getAgentExecutionModeFailure({
                mode: 'apply',
                operation: 'commit',
                requiredTrustMode: 'apply-reversible',
                trustCeiling: 'unbounded',
            })
        ).toBe('Unsupported agent trust ceiling');
    });
});

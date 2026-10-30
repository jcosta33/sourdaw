import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentApprovalSection } from '../components/agentWorkspace/AgentApprovalSection';

const stop = vi.fn();
const renderAudition = vi.fn((input: { confirmationId: string; selectedIntentGroupIds: readonly string[] }) => (
    <section aria-label="Measured audio comparison" data-confirmation-id={input.confirmationId}>
        {input.selectedIntentGroupIds.join(',')}
    </section>
));

type Approval = Parameters<typeof AgentApprovalSection>[0]['approvals'][number];
function approval(): Approval {
    return {
        confirmationId: 'pending',
        canConfirm: false,
        status: 'proposed',
        error: null,
        prompt: 'Make drums punchier',
        batchPosition: null,
        previousProposalDiff: null,
        actionLabels: ['Adjust gain', 'Adjust trim'],
        metricGoals: { status: 'blocked', reason: 'The acoustic objective remains unverified.', criteria: [] },
        scope: { targetIds: ['drums'], protectedTargetIds: [], protectedRanges: [] },
        risk: null,
        recipes: [],
        measuredPreview: null,
        intentGroups: ['gain', 'trim'].map((id) => ({
            id,
            summary: id,
            affectedTrackIds: ['drums'],
            estimatedAudioImpact: { level: 'low', summary: 'Level' },
            warnings: [],
            dependsOnGroupIds: [],
        })),
        destructiveChanges: [],
        partialAcceptance: { available: true, reason: null },
        freshness: { status: 'current' },
        rePreview: { available: true, reason: null },
        consequences: null,
        budgets: null,
        cost: [],
        dataDisclosure: null,
        actor: null,
        expiry: { revision: 'current' },
        createdAt: 0,
        resolvedAt: null,
    };
}
function surface(approvals: Approval[] = [approval()]) {
    return render(
        <AgentApprovalSection
            approvals={approvals}
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
            onRePreview={vi.fn()}
            renderAudition={renderAudition}
            onBeforeSelectionChange={stop}
        />
    );
}

describe('one shared pre-Confirm audition composition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(cleanup);

    it('keeps superseded approval history without mounting another audition owner', () => {
        surface([approval(), { ...approval(), confirmationId: 'superseded', status: 'invalidated' }]);
        expect(screen.getByText('Status: invalidated')).toBeVisible();
        expect(screen.getAllByRole('region', { name: 'Measured audio comparison' })).toHaveLength(1);
        expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveAttribute(
            'data-confirmation-id',
            'pending'
        );
        expect(renderAudition).toHaveBeenCalledExactlyOnceWith({
            confirmationId: 'pending',
            selectedIntentGroupIds: ['gain', 'trim'],
        });
    });

    it('keeps the comparison available while preserving the existing blocked Confirm gate', () => {
        surface();
        expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveTextContent('gain,trim');
        expect(screen.getByRole('button', { name: 'Confirm agent actions' })).toBeDisabled();
    });

    it('retires sound synchronously before partial-selection state changes', () => {
        surface();
        stop.mockImplementationOnce((confirmationId: string) => {
            expect(confirmationId).toBe('pending');
            expect(renderAudition).toHaveBeenLastCalledWith({
                confirmationId: 'pending',
                selectedIntentGroupIds: ['gain', 'trim'],
            });
            expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveTextContent('gain,trim');
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 2: trim' }));
        expect(stop).toHaveBeenCalledTimes(1);
        expect(renderAudition).toHaveBeenLastCalledWith({
            confirmationId: 'pending',
            selectedIntentGroupIds: ['gain'],
        });
        expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveTextContent('gain');
        expect(screen.getByRole('button', { name: 'Confirm agent actions' })).toBeDisabled();
    });
});

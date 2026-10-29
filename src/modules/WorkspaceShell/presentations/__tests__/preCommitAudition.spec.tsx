import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentApprovalSection } from '../components/agentWorkspace/AgentApprovalSection';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), selections: [] as readonly string[][] }));
vi.mock('#/modules/AiRuntime/useCases/startMeasuredPreviewAudition', () => ({
    startMeasuredPreviewAudition: mocks.start,
}));
vi.mock('#/modules/AiRuntime/useCases/stopMeasuredPreviewAudition', () => ({
    stopMeasuredPreviewAudition: mocks.stop,
}));
vi.mock('#/modules/AiRuntime/useCases/getMeasuredPreviewAuditionView', () => ({
    getMeasuredPreviewAuditionView: (input: { confirmationId: string; selectedIntentGroupIds: readonly string[] }) => {
        mocks.selections = [...mocks.selections, [...input.selectedIntentGroupIds]];
        const available = input.selectedIntentGroupIds.length === 2;
        return {
            confirmationId: input.confirmationId,
            phase: 'idle',
            side: null,
            targetId: null,
            error: null,
            reason: null,
            targets: [
                {
                    targetId: 'drums',
                    targetName: 'Drums',
                    available,
                    baselineLufs: -10,
                    proposalLufs: -16,
                    matchedLufs: -16,
                    reason: available ? null : 'Re-preview the selected actions to obtain their exact measured audio.',
                },
            ],
        };
    },
}));

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
function surface() {
    return render(
        <AgentApprovalSection approvals={[approval()]} onConfirm={vi.fn()} onCancel={vi.fn()} onRePreview={vi.fn()} />
    );
}

describe('one shared pre-Confirm audition surface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selections = [];
        mocks.start.mockResolvedValue({ status: 'playing' });
        mocks.stop.mockResolvedValue({ status: 'stopped' });
    });
    afterEach(cleanup);

    it('keeps superseded approval history without mounting another audition owner', () => {
        render(
            <AgentApprovalSection
                approvals={[approval(), { ...approval(), confirmationId: 'superseded', status: 'invalidated' }]}
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
                onRePreview={vi.fn()}
            />
        );
        expect(screen.getByText('Status: invalidated')).toBeVisible();
        expect(screen.getAllByRole('region', { name: 'Measured audio comparison' })).toHaveLength(1);
        expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveAttribute(
            'data-confirmation-id',
            'pending'
        );
        expect(mocks.selections).toEqual([['gain', 'trim']]);
    });

    it('offers the two measured sides while preserving the existing blocked Confirm gate', async () => {
        surface();
        expect(screen.getAllByRole('region', { name: 'Measured audio comparison' })).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Confirm agent actions' })).toBeDisabled();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Baseline', exact: true })));
        expect(mocks.start).toHaveBeenLastCalledWith({
            confirmationId: 'pending',
            targetId: 'drums',
            side: 'baseline',
            selectedIntentGroupIds: ['gain', 'trim'],
        });
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Proposal', exact: true })));
        expect(mocks.start).toHaveBeenLastCalledWith({
            confirmationId: 'pending',
            targetId: 'drums',
            side: 'preview',
            selectedIntentGroupIds: ['gain', 'trim'],
        });
        expect(screen.getByRole('button', { name: 'Confirm agent actions' })).toBeDisabled();
    });

    it('retires sound synchronously before partial-selection state changes and disables stale full-batch PCM', () => {
        surface();
        mocks.stop.mockImplementationOnce((input) => {
            expect(input).toEqual({ confirmationId: 'pending' });
            // The browser toggles the checkbox before onChange. Canonical
            // selection projection must still be the old full batch here.
            expect(mocks.selections.at(-1)).toEqual(['gain', 'trim']);
            return Promise.resolve({ status: 'stopped' });
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include group 2: trim' }));
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.selections.at(-1)).toEqual(['gain']);
        expect(screen.getByRole('button', { name: 'Baseline', exact: true })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Proposal', exact: true })).toBeDisabled();
        expect(mocks.start).not.toHaveBeenCalled();
        mocks.stop.mockResolvedValue({ status: 'stopped' });
    });

    it('retires only its own confirmation when the shared view unmounts', () => {
        const view = surface();
        view.unmount();
        expect(mocks.stop).toHaveBeenCalledWith({ confirmationId: 'pending' });
    });
});

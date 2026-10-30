import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasuredPreviewAudition } from '../MeasuredPreviewAudition';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), selections: [] as readonly string[][] }));
vi.mock('../../../useCases/startMeasuredPreviewAudition', () => ({
    startMeasuredPreviewAudition: mocks.start,
}));
vi.mock('../../../useCases/stopMeasuredPreviewAudition', () => ({
    stopMeasuredPreviewAudition: mocks.stop,
}));
vi.mock('../../../useCases/getMeasuredPreviewAuditionView', () => ({
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

const input = { confirmationId: 'pending', selectedIntentGroupIds: ['gain', 'trim'] };

describe('connected measured audition controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selections = [];
        mocks.start.mockResolvedValue({ status: 'playing' });
        mocks.stop.mockResolvedValue({ status: 'stopped' });
    });
    afterEach(cleanup);

    it('routes both retained sides with the exact confirmation and selected groups', async () => {
        render(<MeasuredPreviewAudition {...input} />);
        expect(screen.getByRole('region', { name: 'Measured audio comparison' })).toHaveAttribute(
            'data-confirmation-id',
            'pending'
        );
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
    });

    it('disables stale full-batch PCM after its caller selects only a subset', () => {
        const view = render(<MeasuredPreviewAudition {...input} />);
        expect(screen.getByRole('button', { name: 'Baseline', exact: true })).toBeEnabled();
        view.rerender(<MeasuredPreviewAudition {...input} selectedIntentGroupIds={['gain']} />);
        expect(mocks.selections.at(-1)).toEqual(['gain']);
        expect(screen.getByRole('button', { name: 'Baseline', exact: true })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Proposal', exact: true })).toBeDisabled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('retires only its own confirmation when the connected view unmounts', () => {
        const view = render(<MeasuredPreviewAudition {...input} />);
        view.unmount();
        expect(mocks.stop).toHaveBeenCalledWith({ confirmationId: 'pending' });
    });
});

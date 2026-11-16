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

const input = { confirmationId: 'pending', selectedIntentGroupIds: ['gain', 'trim'], surface: 'chat' as const };

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
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Baseline' })));
        expect(mocks.start).toHaveBeenLastCalledWith({
            confirmationId: 'pending',
            targetId: 'drums',
            side: 'baseline',
            selectedIntentGroupIds: ['gain', 'trim'],
            surface: 'chat',
        });
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Proposal' })));
        expect(mocks.start).toHaveBeenLastCalledWith({
            confirmationId: 'pending',
            targetId: 'drums',
            side: 'preview',
            selectedIntentGroupIds: ['gain', 'trim'],
            surface: 'chat',
        });
    });

    it('disables stale full-batch PCM after its caller selects only a subset', () => {
        const view = render(<MeasuredPreviewAudition {...input} />);
        expect(screen.getByRole('button', { name: 'Baseline' })).toBeEnabled();
        view.rerender(<MeasuredPreviewAudition {...input} selectedIntentGroupIds={['gain']} />);
        expect(mocks.selections.at(-1)).toEqual(['gain']);
        expect(screen.getByRole('button', { name: 'Baseline' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Proposal' })).toBeDisabled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('retires only what its own surface started for its confirmation when the connected view unmounts', () => {
        const view = render(<MeasuredPreviewAudition {...input} />);
        view.unmount();
        expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ confirmationId: 'pending', surface: 'chat' });
    });

    // Red when a target change stops only this surface's audition, leaving the other surface's playing.
    it('stops the proposal whichever surface started it when the target changes', () => {
        render(<MeasuredPreviewAudition {...input} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Audition target' }), { target: { value: 'drums' } });
        expect(mocks.stop).toHaveBeenLastCalledWith({ confirmationId: 'pending' });
    });
});

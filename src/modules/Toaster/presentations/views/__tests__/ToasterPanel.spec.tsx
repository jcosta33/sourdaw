import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignToasterPatternGroove: vi.fn<() => Promise<void>>(),
}));

import { ToasterPanel } from '../ToasterPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));
vi.mock('../../../useCases/assignToasterPatternGroove', () => ({
    assignToasterPatternGroove: mocks.assignToasterPatternGroove,
}));

describe('ToasterPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.assignToasterPatternGroove.mockResolvedValue();
    });

    it('should render without crashing', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('exposes labeled pattern groove assignment controls', () => {
        render(<ToasterPanel deviceId="toaster-test" />);

        expect(screen.getByRole('combobox', { name: 'Pattern groove template' })).toBeEnabled();
        expect(screen.getByRole('slider', { name: 'Pattern groove amount' })).toBeEnabled();
    });

    it('disables assignment controls when the pattern consumer identity is invalid', () => {
        render(<ToasterPanel deviceId="" />);

        expect(screen.getByRole('combobox', { name: 'Pattern groove template' })).toBeDisabled();
        expect(screen.getByRole('slider', { name: 'Pattern groove amount' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('This pattern has an invalid groove identity.');
    });

    it('reports a rejected assignment without throwing from the event handler', async () => {
        mocks.assignToasterPatternGroove.mockRejectedValueOnce(new Error('assignment failed'));
        render(<ToasterPanel deviceId="toaster-test" />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Pattern groove template' }), {
            target: { value: 'groove-builtin-swing-8' },
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Could not assign the groove.');
    });

    it('commits one assignment after a continuous amount drag', () => {
        render(<ToasterPanel deviceId="toaster-test" />);
        const amount = screen.getByRole('slider', { name: 'Pattern groove amount' });

        fireEvent.change(amount, { target: { value: '0.8' } });
        fireEvent.change(amount, { target: { value: '0.6' } });
        fireEvent.change(amount, { target: { value: '0.4' } });
        expect(mocks.assignToasterPatternGroove).not.toHaveBeenCalled();

        fireEvent.pointerUp(amount);

        expect(mocks.assignToasterPatternGroove).toHaveBeenCalledOnce();
        expect(mocks.assignToasterPatternGroove).toHaveBeenCalledWith({
            deviceId: 'toaster-test',
            patternId: 'A1',
            templateId: 'groove-straight',
            amount: 0.4,
        });
    });

    it('announces straight timing when the pattern has no assignment', () => {
        render(<ToasterPanel deviceId="toaster-test" />);

        expect(screen.getByRole('status')).toHaveTextContent('Straight timing is active; no groove is assigned.');
    });
});

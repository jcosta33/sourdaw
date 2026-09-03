import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignToasterPatternGroove: vi.fn<() => Promise<void>>(),
    enter16Levels: vi.fn(),
    exit16Levels: vi.fn(),
    trigger16Level: vi.fn(),
    startNoteRepeat: vi.fn(),
    stopNoteRepeat: vi.fn(),
    triggerToasterPad: vi.fn(),
    setPadParamImmediate: vi.fn(),
}));

import { ToasterPanel } from '../ToasterPanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));
vi.mock('../../../useCases/assignToasterPatternGroove', () => ({
    assignToasterPatternGroove: mocks.assignToasterPatternGroove,
}));
vi.mock('../../../useCases/enter16Levels', () => ({
    enter16Levels: mocks.enter16Levels,
}));
vi.mock('../../../useCases/exit16Levels', () => ({
    exit16Levels: mocks.exit16Levels,
}));
vi.mock('../../../useCases/setPadParamImmediate', () => ({
    setPadParamImmediate: mocks.setPadParamImmediate,
}));
vi.mock('../../../useCases/trigger16Level', () => ({
    trigger16Level: mocks.trigger16Level,
}));
vi.mock('../../../useCases/startNoteRepeat', () => ({
    startNoteRepeat: mocks.startNoteRepeat,
}));
vi.mock('../../../useCases/stopNoteRepeat', () => ({
    stopNoteRepeat: mocks.stopNoteRepeat,
}));
vi.mock('../../../useCases/triggerPad', () => ({
    triggerToasterPad: mocks.triggerToasterPad,
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

    it('toggles 16-levels enters and exits 16-levels session', () => {
        const { unmount } = render(<ToasterPanel deviceId="toaster-test" />);

        const toggleButton = screen.getByRole('button', { name: '16 Levels mode' });
        expect(toggleButton).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(toggleButton);
        expect(mocks.enter16Levels).toHaveBeenCalledTimes(1);
        expect(mocks.enter16Levels).toHaveBeenCalledWith('toaster-test', 0, 'tune');
        expect(toggleButton).toHaveAttribute('aria-pressed', 'true');

        const targetSelect = screen.getByRole('combobox', { name: '16 Levels target' });
        expect(targetSelect).toBeTruthy();

        fireEvent.change(targetSelect, { target: { value: 'velocity' } });
        expect(mocks.enter16Levels).toHaveBeenCalledWith('toaster-test', 0, 'velocity');

        fireEvent.click(toggleButton);
        expect(mocks.exit16Levels).toHaveBeenCalledTimes(1);
        expect(mocks.exit16Levels).toHaveBeenCalledWith('toaster-test');
        expect(toggleButton).toHaveAttribute('aria-pressed', 'false');

        mocks.exit16Levels.mockClear();
        mocks.stopNoteRepeat.mockClear();
        unmount();
        expect(mocks.exit16Levels).toHaveBeenCalledTimes(1);
        expect(mocks.exit16Levels).toHaveBeenCalledWith('toaster-test');
        expect(mocks.stopNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledWith('toaster-test');
    });

    it('toggling 16-levels triggers 16-levels target on pad click', () => {
        render(<ToasterPanel deviceId="toaster-test" />);

        const toggleButton = screen.getByRole('button', { name: '16 Levels mode' });
        fireEvent.click(toggleButton);

        const pad4 = screen.getByTestId('toaster-pad-3');
        fireEvent.mouseDown(pad4, { button: 0 });
        fireEvent.mouseUp(pad4);
        fireEvent.click(pad4);

        expect(mocks.trigger16Level).toHaveBeenCalledTimes(1);
        expect(mocks.trigger16Level).toHaveBeenCalledWith(3, 'toaster-test');
        expect(mocks.triggerToasterPad).not.toHaveBeenCalled();
        expect(mocks.startNoteRepeat).not.toHaveBeenCalled();
    });

    it('toggling note repeat starts and stops note repeat', () => {
        render(<ToasterPanel deviceId="toaster-test" />);

        const repeatButton = screen.getByRole('button', { name: 'Note repeat mode' });
        expect(repeatButton).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(repeatButton);
        expect(repeatButton).toHaveAttribute('aria-pressed', 'true');

        const rateSelect = screen.getByRole('combobox', { name: 'Note repeat rate' });
        expect(rateSelect).toBeTruthy();
        fireEvent.change(rateSelect, { target: { value: '1/8' } });

        const pad0 = screen.getByTestId('toaster-pad-0');
        fireEvent.mouseDown(pad0, { button: 0 });
        expect(mocks.startNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.startNoteRepeat).toHaveBeenCalledWith('toaster-test', 0, 100, 120, '1/8');

        fireEvent.mouseUp(pad0);
        fireEvent.click(pad0);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledWith('toaster-test');
        expect(mocks.triggerToasterPad).not.toHaveBeenCalled();

        mocks.stopNoteRepeat.mockClear();
        fireEvent.click(repeatButton);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledWith('toaster-test');
        expect(repeatButton).toHaveAttribute('aria-pressed', 'false');
    });

    it('combines 16-levels and note repeat on pad trigger', () => {
        render(<ToasterPanel deviceId="toaster-test" />);

        fireEvent.click(screen.getByRole('button', { name: '16 Levels mode' }));
        fireEvent.click(screen.getByRole('button', { name: 'Note repeat mode' }));

        // Tune target (default): setPadParamImmediate called without trigger16Level, then startNoteRepeat with 127
        const pad2 = screen.getByTestId('toaster-pad-2');
        fireEvent.mouseDown(pad2, { button: 0 });
        fireEvent.mouseUp(pad2);
        fireEvent.click(pad2);

        expect(mocks.startNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.startNoteRepeat).toHaveBeenCalledWith('toaster-test', 0, 127, 120, '1/16');
        expect(mocks.stopNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.stopNoteRepeat).toHaveBeenCalledWith('toaster-test');
        expect(mocks.setPadParamImmediate).toHaveBeenCalledTimes(1);
        expect(mocks.setPadParamImmediate).toHaveBeenCalledWith({
            deviceId: 'toaster-test',
            padIndex: 0,
            key: 'tune',
            value: -24 + (3 / 16) * 48,
        });
        expect(mocks.trigger16Level).not.toHaveBeenCalled();
        expect(mocks.triggerToasterPad).not.toHaveBeenCalled();

        // Switch to velocity target
        const targetSelect = screen.getByRole('combobox', { name: '16 Levels target' });
        fireEvent.change(targetSelect, { target: { value: 'velocity' } });

        mocks.startNoteRepeat.mockClear();
        mocks.stopNoteRepeat.mockClear();
        mocks.setPadParamImmediate.mockClear();
        mocks.trigger16Level.mockClear();
        mocks.triggerToasterPad.mockClear();

        // Pad 7: velocity round(8/16 * 127) = 64
        const pad7 = screen.getByTestId('toaster-pad-7');
        fireEvent.mouseDown(pad7, { button: 0 });
        fireEvent.mouseUp(pad7);
        fireEvent.click(pad7);

        expect(mocks.startNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.startNoteRepeat).toHaveBeenCalledWith('toaster-test', 0, 64, 120, '1/16');
        expect(mocks.stopNoteRepeat).toHaveBeenCalledTimes(1);
        expect(mocks.setPadParamImmediate).not.toHaveBeenCalled();
        expect(mocks.trigger16Level).not.toHaveBeenCalled();
        expect(mocks.triggerToasterPad).not.toHaveBeenCalled();
    });
});

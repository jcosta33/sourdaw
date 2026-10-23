import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#d97706'),
}));

import { CompressorCurve } from '../CompressorCurve';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CompressorCurve — canvas structure', () => {
    it('renders a canvas with role="img"', () => {
        render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('aria-label is "Compressor transfer curve"', () => {
        render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Compressor transfer curve');
    });

    it('default width/height are 120', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        const canvas = container.querySelector('canvas')!;
        expect(canvas.getAttribute('width')).toBe('120');
        expect(canvas.getAttribute('height')).toBe('120');
    });
});

describe('CompressorCurve — interactive mode', () => {
    it('sets cursor to grab when interactive', () => {
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')!.style.cursor).toBe('grab');
    });

    it('does not set cursor when not interactive', () => {
        const { container } = render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} />);
        expect(container.querySelector('canvas')!.style.cursor).toBe('');
    });

    it('calls onParamChange with comp-threshold when dragging', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 10, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledTimes(1);
        expect(onParamChange.mock.calls[0]?.[0]).toBe('comp-threshold');
    });

    it('does not fire onParamChange on move without down', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        fireEvent.pointerMove(container.querySelector('canvas')!, { clientY: 10 });
        expect(onParamChange).not.toHaveBeenCalled();
    });

    it('stops after pointerUp', () => {
        const onParamChange = vi.fn();
        const { container } = render(
            <CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onParamChange={onParamChange} />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () => ({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => {},
        });
        fireEvent.pointerDown(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 20, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientY: 30, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledTimes(1);
    });
});

describe('CompressorCurve — opt-in gesture lifecycle', () => {
    function setup() {
        const onParamChange = vi.fn();
        const onGestureStart = vi.fn(() => true);
        const onGestureCommit = vi.fn();
        const onGestureCancel = vi.fn();
        const view = render(
            <CompressorCurve
                threshold={-20}
                ratio={4}
                knee={6}
                makeup={0}
                onParamChange={onParamChange}
                onGestureStart={onGestureStart}
                onGestureCommit={onGestureCommit}
                onGestureCancel={onGestureCancel}
            />
        );
        const canvas = screen.getByRole('img', { name: 'Compressor transfer curve' });
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            width: 120,
            height: 120,
            right: 120,
            bottom: 120,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        return { ...view, canvas, onParamChange, onGestureStart, onGestureCommit, onGestureCancel };
    }

    it('delivers physical moves and commits the last sample once without another change callback', () => {
        const { canvas, onParamChange, onGestureStart, onGestureCommit, onGestureCancel } = setup();
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 8 });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 32 });
        fireEvent.pointerMove(canvas, { pointerId: 8, clientY: 116 });
        fireEvent.pointerUp(canvas, { pointerId: 8 });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 60 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        fireEvent.lostPointerCapture(canvas, { pointerId: 7 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onGestureStart).toHaveBeenCalledOnce();
        expect(onParamChange.mock.calls).toEqual([
            ['comp-threshold', -15],
            ['comp-threshold', -30],
        ]);
        expect(onGestureCommit).toHaveBeenCalledExactlyOnceWith('comp-threshold', -30);
        expect(onGestureCancel).not.toHaveBeenCalled();
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'hidden', 'unmount'])(
        'cancels %s exactly once and never commits an unfinished sample',
        (finish) => {
            const { canvas, unmount, onParamChange, onGestureCommit, onGestureCancel } = setup();
            fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
            fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 60 });
            if (finish === 'pointerCancel') {
                fireEvent.pointerCancel(canvas, { pointerId: 7 });
            } else if (finish === 'lostPointerCapture') {
                fireEvent.lostPointerCapture(canvas, { pointerId: 7 });
            } else if (finish === 'windowBlur') {
                fireEvent.blur(window);
            } else if (finish === 'hidden') {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                fireEvent(document, new Event('visibilitychange'));
                vi.restoreAllMocks();
            } else {
                unmount();
            }
            fireEvent.pointerUp(canvas, { pointerId: 7 });
            fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 32 });
            expect(onParamChange).toHaveBeenCalledExactlyOnceWith('comp-threshold', -30);
            expect(onGestureCancel).toHaveBeenCalledOnce();
            expect(onGestureCommit).not.toHaveBeenCalled();
        }
    );

    it('does not manufacture a sample from an orphan release or a click with no move', () => {
        const { canvas, onParamChange, onGestureCommit, onGestureCancel } = setup();
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledOnce();
    });

    it('does not admit pointer movement when the owning gesture refuses its start', () => {
        const { canvas, onGestureStart, onParamChange, onGestureCommit } = setup();
        onGestureStart.mockReturnValue(false);
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 60 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
    });

    it('cancels a nonfinite physical coordinate before it can reach a callback', () => {
        const { canvas, onParamChange, onGestureCancel, onGestureCommit } = setup();
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
        const malformed = new Event('pointermove', { bubbles: true });
        Object.defineProperties(malformed, { pointerId: { value: 7 }, clientY: { value: Number.NaN } });
        fireEvent(canvas, malformed);
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledOnce();
        expect(onGestureCommit).not.toHaveBeenCalled();
    });

    it('keeps a callback-free curve read-only even when lifecycle callbacks are supplied', () => {
        const onGestureStart = vi.fn(() => true);
        render(<CompressorCurve threshold={-20} ratio={4} knee={6} makeup={0} onGestureStart={onGestureStart} />);
        const canvas = screen.getByRole('img', { name: 'Compressor transfer curve' });
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7 });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientY: 60 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onGestureStart).not.toHaveBeenCalled();
        expect(canvas.style.cursor).toBe('');
    });
});

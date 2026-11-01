import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DistortionCurve } from '../DistortionCurve';

const values = { drive: 20, tone: 4000, mix: 0.5 };

afterEach(() => vi.restoreAllMocks());

function setup() {
    const onParamChange = vi.fn();
    const onGestureStart = vi.fn(() => 7);
    const isGestureCurrent = vi.fn((token: number) => token === 7);
    const onGestureCommit = vi.fn();
    const onGestureCancel = vi.fn();
    const callbacks = { onParamChange, onGestureStart, isGestureCurrent, onGestureCommit, onGestureCancel };
    const view = render(<DistortionCurve {...values} {...callbacks} />);
    const canvas = screen.getByRole('img', { name: 'Distortion transfer curve' });
    return { ...view, canvas, callbacks, ...callbacks };
}

function down(canvas: HTMLElement, pointerId = 5) {
    fireEvent.pointerDown(canvas, { button: 0, pointerId, clientY: 100 });
}

function move(canvas: HTMLElement, clientY = 80, pointerId = 5) {
    fireEvent.pointerMove(canvas, { pointerId, clientY });
}

function up(canvas: HTMLElement, pointerId = 5) {
    fireEvent.pointerUp(canvas, { pointerId });
}

describe('DistortionCurve', () => {
    it('renders the read-only canvas with its existing dimensions and drawing', () => {
        render(<DistortionCurve {...values} />);
        const canvas = screen.getByRole('img', { name: 'Distortion transfer curve' });
        expect(canvas).toHaveAttribute('width', '200');
        expect(canvas).toHaveAttribute('height', '120');
        expect(canvas.style.cursor).toBe('');
    });

    it('preserves callback-only consumers and accumulates relative drive changes without a rerender', () => {
        const onParamChange = vi.fn();
        render(<DistortionCurve {...values} onParamChange={onParamChange} />);
        const canvas = screen.getByRole('img');
        down(canvas);
        for (const clientY of [80, 60, -100, -120, 0]) {
            move(canvas, clientY);
        }
        up(canvas);
        move(canvas, -40);
        expect(onParamChange.mock.calls).toEqual([30, 40, 100, 100, 40].map((value) => ['dist-drive', value]));
    });

    it('ignores other pointers and reentrant release, and settles once without another physical sample', () => {
        const { canvas, onParamChange, onGestureStart, onGestureCommit, onGestureCancel } = setup();
        Object.defineProperty(canvas, 'hasPointerCapture', { configurable: true, value: () => true });
        const release = vi.spyOn(canvas, 'releasePointerCapture').mockImplementation((pointerId) => {
            fireEvent.lostPointerCapture(canvas, { pointerId });
        });
        down(canvas);
        down(canvas, 6);
        move(canvas, 10, 6);
        up(canvas, 6);
        fireEvent.pointerCancel(canvas, { pointerId: 6 });
        move(canvas, 80);
        move(canvas, 60);
        up(canvas);
        up(canvas);
        expect(onGestureStart).toHaveBeenCalledOnce();
        expect(onParamChange.mock.calls).toEqual([
            ['dist-drive', 30],
            ['dist-drive', 40],
        ]);
        expect(release).toHaveBeenCalledExactlyOnceWith(5);
        expect(onGestureCommit).toHaveBeenCalledOnce();
        expect(onGestureCancel).not.toHaveBeenCalled();
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'blur', 'hidden', 'unmount'])(
        'cancels %s once and ignores subsequent physical events',
        (ending) => {
            const { canvas, unmount, onParamChange, onGestureCommit, onGestureCancel } = setup();
            down(canvas);
            move(canvas);
            if (ending === 'unmount') {
                unmount();
            } else if (ending === 'blur') {
                fireEvent.blur(window);
            } else if (ending === 'hidden') {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                fireEvent(document, new Event('visibilitychange'));
            } else {
                fireEvent[ending === 'pointerCancel' ? 'pointerCancel' : 'lostPointerCapture'](canvas, {
                    pointerId: 5,
                });
            }
            up(canvas);
            move(canvas, 60);
            expect(onParamChange).toHaveBeenCalledExactlyOnceWith('dist-drive', 30);
            expect(onGestureCancel).toHaveBeenCalledOnce();
            expect(onGestureCommit).not.toHaveBeenCalled();
        }
    );

    it('rolls back a failed capture and accepts the next physical drag', () => {
        const { canvas, onParamChange, onGestureCommit, onGestureCancel } = setup();
        const capture = vi.spyOn(canvas, 'setPointerCapture').mockImplementationOnce(() => {
            throw new DOMException('Pointer is not active', 'NotFoundError');
        });
        down(canvas);
        move(canvas);
        up(canvas);
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledOnce();
        expect(onGestureCommit).not.toHaveBeenCalled();
        expect(canvas.style.cursor).toBe('grab');
        down(canvas, 6);
        move(canvas, 80, 6);
        up(canvas, 6);
        expect(capture).toHaveBeenCalledTimes(2);
        expect(onParamChange).toHaveBeenCalledExactlyOnceWith('dist-drive', 30);
        expect(onGestureCommit).toHaveBeenCalledOnce();
    });

    it('does not revive a gesture canceled synchronously during capture acquisition', () => {
        const { canvas, onParamChange, onGestureCommit, onGestureCancel } = setup();
        vi.spyOn(canvas, 'setPointerCapture').mockImplementationOnce((pointerId) => {
            fireEvent.lostPointerCapture(canvas, { pointerId });
        });
        down(canvas);
        move(canvas);
        up(canvas);
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledOnce();
        expect(canvas.style.cursor).toBe('grab');
    });

    it('keeps a missing callback read-only and rejects a refused gesture start', () => {
        const { canvas, rerender, callbacks, onGestureStart, onParamChange, onGestureCommit } = setup();
        onGestureStart.mockReturnValue(-1);
        down(canvas);
        move(canvas);
        up(canvas);
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
        rerender(<DistortionCurve {...values} onGestureStart={callbacks.onGestureStart} />);
        onGestureStart.mockClear();
        down(canvas);
        expect(onGestureStart).not.toHaveBeenCalled();
        expect(canvas.style.cursor).toBe('');
    });

    it('retires the original callback owner when its target changes', () => {
        const { canvas, rerender, callbacks, isGestureCurrent, onGestureCommit, onGestureCancel } = setup();
        down(canvas);
        move(canvas);
        isGestureCurrent.mockReturnValue(false);
        const successor = vi.fn();
        rerender(<DistortionCurve {...values} {...callbacks} onGestureCancel={successor} />);
        up(canvas);
        expect(onGestureCancel).toHaveBeenCalledOnce();
        expect(successor).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
    });

    it('cancels a nonfinite coordinate before it reaches the parameter callback', () => {
        const { canvas, onParamChange, onGestureCancel, onGestureCommit } = setup();
        down(canvas);
        const event = new Event('pointermove', { bubbles: true });
        Object.defineProperties(event, { pointerId: { value: 5 }, clientY: { value: Number.NaN } });
        fireEvent(canvas, event);
        up(canvas);
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledOnce();
        expect(onGestureCommit).not.toHaveBeenCalled();
    });
});

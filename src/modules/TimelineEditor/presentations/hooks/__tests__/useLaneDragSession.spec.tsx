import { render, screen, within, fireEvent } from '@testing-library/react';
import { type PointerEvent, type ReactElement } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { isDragGestureActive } from '#/utils/UI/activeDragGesture';

import { useLaneDragSession } from '../useLaneDragSession';

type SessionCallbacks = {
    move: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
};

/** The smallest lane: one handle that arms a session on press, inside a host carrying the handlers. */
const LaneHarness = ({ callbacks }: { callbacks: SessionCallbacks }): ReactElement => {
    const { hasActiveDrag, beginDrag, dragHandlers } = useLaneDragSession();
    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (hasActiveDrag()) {
            return;
        }
        beginDrag({
            pointerId: event.pointerId,
            captureTarget: event.currentTarget,
            move: callbacks.move,
            commit: callbacks.commit,
            cancel: callbacks.cancel,
        });
    };
    return (
        <div data-testid="host" {...dragHandlers}>
            <div data-testid="handle" onPointerDown={handlePointerDown} />
        </div>
    );
};

const renderArmedLane = (): { callbacks: SessionCallbacks; handle: HTMLElement; unmount: () => void } => {
    const callbacks: SessionCallbacks = { move: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
    const view = render(<LaneHarness callbacks={callbacks} />);
    const handle = within(view.container).getByTestId('handle');
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    return { callbacks, handle, unmount: view.unmount };
};

const pressEscape = (init: KeyboardEventInit = {}): void => {
    fireEvent.keyDown(window, { key: 'Escape', ...init });
};

describe('useLaneDragSession', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Escape', () => {
        it('cancels an armed drag instead of committing it', () => {
            const { callbacks } = renderArmedLane();

            pressEscape();

            expect(callbacks.cancel).toHaveBeenCalledTimes(1);
            expect(callbacks.commit).not.toHaveBeenCalled();
        });

        it('releases capture and stops forwarding moves once cancelled', () => {
            const { callbacks, handle } = renderArmedLane();
            const release = vi.spyOn(handle, 'releasePointerCapture');

            pressEscape();
            fireEvent.pointerMove(handle, { pointerId: 3, clientX: 90, clientY: 40 });

            expect(release).toHaveBeenCalledWith(3);
            expect(callbacks.move).not.toHaveBeenCalled();
        });

        it('lets the trailing release and lost capture after a cancel commit nothing', () => {
            const { callbacks, handle } = renderArmedLane();

            pressEscape();
            fireEvent.lostPointerCapture(handle, { pointerId: 3 });
            fireEvent.pointerUp(handle, { pointerId: 3 });

            expect(callbacks.commit).not.toHaveBeenCalled();
            expect(callbacks.cancel).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['Shift', { shiftKey: true }],
            ['Ctrl', { ctrlKey: true }],
            ['Alt', { altKey: true }],
            ['Meta', { metaKey: true }],
        ])('leaves the drag running on %s+Escape', (_modifier, init) => {
            const { callbacks, handle } = renderArmedLane();

            pressEscape(init);
            fireEvent.pointerMove(handle, { pointerId: 3, clientX: 90, clientY: 40 });

            expect(callbacks.cancel).not.toHaveBeenCalled();
            expect(callbacks.move).toHaveBeenCalledWith({ clientX: 90, clientY: 40 });
        });

        it('ignores other keys while armed', () => {
            const { callbacks } = renderArmedLane();

            fireEvent.keyDown(window, { key: 'a' });

            expect(callbacks.cancel).not.toHaveBeenCalled();
            expect(callbacks.commit).not.toHaveBeenCalled();
        });

        it('does nothing once the drag has already committed', () => {
            const { callbacks, handle } = renderArmedLane();

            fireEvent.pointerUp(handle, { pointerId: 3 });
            pressEscape();

            expect(callbacks.commit).toHaveBeenCalledTimes(1);
            expect(callbacks.cancel).not.toHaveBeenCalled();
        });

        it('still shows the drag to the Escape owners that listen before it', () => {
            // The global shortcut layer's window listener is registered at app start, before any
            // drag arms; the virtual keyboard listens in the capture phase. Both must see the
            // mark on the Escape that cancels the drag, or they act on it too.
            const seenByShortcutLayer: boolean[] = [];
            const seenByKeyboard: boolean[] = [];
            const shortcutLayer = (): void => {
                seenByShortcutLayer.push(isDragGestureActive());
            };
            const keyboard = (): void => {
                seenByKeyboard.push(isDragGestureActive());
            };
            window.addEventListener('keydown', shortcutLayer);
            window.addEventListener('keydown', keyboard, { capture: true });
            try {
                const { callbacks } = renderArmedLane();
                pressEscape();

                expect(callbacks.cancel).toHaveBeenCalledTimes(1);
                expect(seenByShortcutLayer).toEqual([true]);
                expect(seenByKeyboard).toEqual([true]);
                expect(isDragGestureActive()).toBe(false);
            } finally {
                window.removeEventListener('keydown', shortcutLayer);
                window.removeEventListener('keydown', keyboard, { capture: true });
            }
        });

        it('arms a fresh drag after a cancel, so the lane is not left latched', () => {
            const { callbacks, handle } = renderArmedLane();

            pressEscape();
            fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 10, clientY: 10 });
            fireEvent.pointerMove(handle, { pointerId: 4, clientX: 50, clientY: 20 });

            expect(callbacks.move).toHaveBeenCalledWith({ clientX: 50, clientY: 20 });
        });
    });

    describe('drag mark', () => {
        it('is set while armed', () => {
            renderArmedLane();

            expect(isDragGestureActive()).toBe(true);
        });

        it('is not set when taking capture fails', () => {
            const callbacks: SessionCallbacks = { move: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
            render(<LaneHarness callbacks={callbacks} />);
            const handle = screen.getByTestId('handle');
            vi.spyOn(handle, 'setPointerCapture').mockImplementation(() => {
                throw new DOMException('NotAllowed', 'NotAllowedError');
            });
            // React re-dispatches a throwing handler as a window error event; swallow it in the
            // capture phase so this deliberate throw is not reported as a suite error.
            const swallow = (event: Event): void => {
                event.preventDefault();
                event.stopImmediatePropagation();
            };
            window.addEventListener('error', swallow, true);
            try {
                fireEvent.pointerDown(handle, { pointerId: 3, button: 0 });
            } finally {
                window.removeEventListener('error', swallow, true);
            }

            expect(isDragGestureActive()).toBe(false);
            pressEscape();
            expect(callbacks.cancel).not.toHaveBeenCalled();
        });

        it.each([
            [
                'pointerup',
                (handle: HTMLElement): void => {
                    fireEvent.pointerUp(handle, { pointerId: 3 });
                },
            ],
            [
                'pointercancel',
                (handle: HTMLElement): void => {
                    fireEvent.pointerCancel(handle, { pointerId: 3 });
                },
            ],
            [
                'lostpointercapture',
                (handle: HTMLElement): void => {
                    fireEvent.lostPointerCapture(handle, { pointerId: 3 });
                },
            ],
            [
                'window blur',
                (): void => {
                    fireEvent(window, new Event('blur'));
                },
            ],
            [
                'Escape',
                (): void => {
                    pressEscape();
                },
            ],
        ])('is cleared by %s, and a second lane drag still counts afterwards', (_exit, end) => {
            const { handle } = renderArmedLane();

            end(handle);
            expect(isDragGestureActive()).toBe(false);

            // A second clear of the same drag would take this one's count with it.
            const other = renderArmedLane();
            fireEvent.lostPointerCapture(handle, { pointerId: 3 });
            fireEvent.pointerUp(handle, { pointerId: 3 });
            expect(isDragGestureActive()).toBe(true);
            fireEvent.pointerUp(other.handle, { pointerId: 3 });
        });

        it('is cleared when the tab is hidden', () => {
            renderArmedLane();
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            try {
                fireEvent(document, new Event('visibilitychange'));
            } finally {
                Reflect.deleteProperty(document, 'visibilityState');
            }

            expect(isDragGestureActive()).toBe(false);
        });

        it('is cleared when the lane unmounts mid-drag', () => {
            const { callbacks, unmount } = renderArmedLane();

            unmount();

            expect(isDragGestureActive()).toBe(false);
            expect(callbacks.commit).toHaveBeenCalledTimes(1);
        });

        it('ends only its own count, so a drag still running elsewhere stays marked', () => {
            const { handle } = renderArmedLane();
            const second = renderArmedLane();

            fireEvent.pointerUp(handle, { pointerId: 3 });
            expect(isDragGestureActive()).toBe(true);

            fireEvent.pointerUp(second.handle, { pointerId: 3 });
            expect(isDragGestureActive()).toBe(false);
        });
    });
});

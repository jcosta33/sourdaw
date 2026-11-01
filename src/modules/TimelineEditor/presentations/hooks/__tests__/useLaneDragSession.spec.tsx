import { type PointerEvent, type ReactElement } from 'react';

import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';

import { isDragGestureActive } from '#/utils/UI/activeDragGesture';

import { type LanePointerPosition, useLaneDragSession } from '../useLaneDragSession';

type SessionCallbacks = {
    move: Mock<(position: LanePointerPosition) => void>;
    commit: Mock<() => void>;
    cancel: Mock<() => void>;
    /** Clicks that reach the lane host, the ancestor a release's click lands on without capture. */
    click: Mock<() => void>;
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
        <div data-testid="host" onClick={callbacks.click} {...dragHandlers}>
            <div data-testid="handle" onPointerDown={handlePointerDown} />
        </div>
    );
};

type ArmedLane = { callbacks: SessionCallbacks; handle: HTMLElement; host: HTMLElement; unmount: () => void };

const makeCallbacks = (): SessionCallbacks => ({
    move: vi.fn<(position: LanePointerPosition) => void>(),
    commit: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
    click: vi.fn<() => void>(),
});

const renderArmedLane = (): ArmedLane => {
    const callbacks = makeCallbacks();
    const view = render(<LaneHarness callbacks={callbacks} />);
    const handle = within(view.container).getByTestId('handle');
    const host = within(view.container).getByTestId('host');
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 10, clientY: 10 });
    return { callbacks, handle, host, unmount: view.unmount };
};

/**
 * Counts the window `keydown` listeners added and not yet removed since this was called — the
 * Escape listeners an armed drag still holds. Spies call through, so listeners still work.
 */
const trackWindowKeydownListeners = (): (() => number) => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const keydownHandlers = (calls: unknown[][]): unknown[] =>
        calls.filter((call) => call[0] === 'keydown').map((call) => call[1]);
    return () => {
        const removed = keydownHandlers(removeSpy.mock.calls);
        return keydownHandlers(addSpy.mock.calls).filter((handler) => !removed.includes(handler)).length;
    };
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

        it('keeps capture for the held press and stops forwarding moves once cancelled', () => {
            const { callbacks, handle } = renderArmedLane();
            const release = vi.spyOn(handle, 'releasePointerCapture');

            pressEscape();
            fireEvent.pointerMove(handle, { pointerId: 3, clientX: 90, clientY: 40 });

            // The browser releases capture itself after the press's own pointerup.
            expect(release).not.toHaveBeenCalled();
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

        it('leaves a drag begun while Escape is held running on its auto-repeat', () => {
            const { callbacks, handle } = renderArmedLane();

            pressEscape({ repeat: true });
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

    describe('the click after a cancelled press', () => {
        it.each([
            ['the capture target', (lane: ArmedLane): HTMLElement => lane.handle],
            ['its ancestor', (lane: ArmedLane): HTMLElement => lane.host],
        ])('is swallowed once on %s, and the next click goes through', (_where, clickTarget) => {
            const lane = renderArmedLane();
            const target = clickTarget(lane);

            pressEscape();
            fireEvent.pointerUp(target, { pointerId: 3 });
            const swallowed = fireEvent.click(target);

            expect(lane.callbacks.click).not.toHaveBeenCalled();
            expect(swallowed).toBe(false);

            fireEvent.click(target);
            expect(lane.callbacks.click).toHaveBeenCalledTimes(1);
        });

        it('is swallowed when the release lands before capture would have retargeted it', () => {
            const lane = renderArmedLane();

            pressEscape();
            fireEvent.lostPointerCapture(lane.handle, { pointerId: 3 });
            fireEvent.pointerUp(lane.host, { pointerId: 3 });
            fireEvent.click(lane.host);

            expect(lane.callbacks.click).not.toHaveBeenCalled();
            expect(lane.callbacks.commit).not.toHaveBeenCalled();
        });

        it.each([
            [
                'the next pointerdown',
                (lane: ArmedLane): void => {
                    fireEvent.pointerDown(lane.host, { pointerId: 5, button: 0 });
                },
            ],
            [
                'the pressed pointer cancelling',
                (lane: ArmedLane): void => {
                    fireEvent.pointerCancel(lane.handle, { pointerId: 3 });
                },
            ],
        ])('is no longer swallowed after %s', (_end, end) => {
            const lane = renderArmedLane();

            pressEscape();
            end(lane);
            fireEvent.click(lane.host);

            expect(lane.callbacks.click).toHaveBeenCalledTimes(1);
        });

        it('is no longer swallowed once the release task has ended without a click', () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                const lane = renderArmedLane();

                pressEscape();
                fireEvent.pointerUp(lane.handle, { pointerId: 3 });
                vi.runAllTimers();
                fireEvent.click(lane.host);

                expect(lane.callbacks.click).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('is no longer swallowed after the lane unmounts', () => {
            const lane = renderArmedLane();
            const outside = vi.fn();
            document.body.addEventListener('click', outside);
            try {
                pressEscape();
                lane.unmount();
                fireEvent.click(document.body);
            } finally {
                document.body.removeEventListener('click', outside);
            }

            expect(outside).toHaveBeenCalledTimes(1);
        });

        it('ignores another pointer cancelling', () => {
            const lane = renderArmedLane();

            pressEscape();
            fireEvent.pointerCancel(lane.host, { pointerId: 8 });
            fireEvent.pointerUp(lane.handle, { pointerId: 3 });
            fireEvent.click(lane.handle);

            expect(lane.callbacks.click).not.toHaveBeenCalled();
        });

        it('ignores another pointer releasing first', () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                const lane = renderArmedLane();

                pressEscape();
                fireEvent.pointerUp(lane.host, { pointerId: 8 });
                vi.runAllTimers();
                fireEvent.pointerUp(lane.handle, { pointerId: 3 });
                fireEvent.click(lane.host);

                expect(lane.callbacks.click).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it.each([
            [
                'the window losing focus',
                (): void => {
                    fireEvent(window, new Event('blur'));
                },
            ],
            [
                'the tab hiding',
                (): void => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                    try {
                        fireEvent(document, new Event('visibilitychange'));
                    } finally {
                        Reflect.deleteProperty(document, 'visibilityState');
                    }
                },
            ],
        ])('is no longer swallowed after %s, where the release may never reach the page', (_leave, leave) => {
            const lane = renderArmedLane();

            pressEscape();
            leave();
            fireEvent.click(lane.host);

            expect(lane.callbacks.click).toHaveBeenCalledTimes(1);
        });

        it('leaves the click after a committed drag alone', () => {
            const lane = renderArmedLane();

            fireEvent.pointerUp(lane.handle, { pointerId: 3 });
            fireEvent.click(lane.handle);

            expect(lane.callbacks.commit).toHaveBeenCalledTimes(1);
            expect(lane.callbacks.click).toHaveBeenCalledTimes(1);
        });
    });

    describe('Escape listener teardown', () => {
        it.each([
            [
                'commit on pointerup',
                (lane: ArmedLane): void => {
                    fireEvent.pointerUp(lane.handle, { pointerId: 3 });
                },
            ],
            [
                'Escape cancel',
                (): void => {
                    pressEscape();
                },
            ],
            [
                'window blur',
                (): void => {
                    fireEvent(window, new Event('blur'));
                },
            ],
            [
                'the tab hiding',
                (): void => {
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                    try {
                        fireEvent(document, new Event('visibilitychange'));
                    } finally {
                        Reflect.deleteProperty(document, 'visibilityState');
                    }
                },
            ],
            [
                'unmount',
                (lane: ArmedLane): void => {
                    lane.unmount();
                },
            ],
            [
                'pointercancel',
                (lane: ArmedLane): void => {
                    fireEvent.pointerCancel(lane.handle, { pointerId: 3 });
                },
            ],
            [
                'lostpointercapture',
                (lane: ArmedLane): void => {
                    fireEvent.lostPointerCapture(lane.handle, { pointerId: 3 });
                },
            ],
        ])('leaves no Escape listener on window after %s', (_exit, end) => {
            const liveKeydownListeners = trackWindowKeydownListeners();
            const lane = renderArmedLane();
            expect(liveKeydownListeners()).toBe(1);

            end(lane);

            expect(liveKeydownListeners()).toBe(0);
        });
    });

    describe('drag mark', () => {
        it('is set while armed', () => {
            renderArmedLane();

            expect(isDragGestureActive()).toBe(true);
        });

        it('is not set when taking capture fails', () => {
            const callbacks = makeCallbacks();
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

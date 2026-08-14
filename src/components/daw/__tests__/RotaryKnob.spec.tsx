import { type MouseEvent as ReactMouseEvent } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RotaryKnob, type GestureAuthority } from '../RotaryKnob';

type PointerCaptureSpy = {
    capturedPointerId: number | null;
    events: string[];
};

const installPointerCaptureSpy = (element: HTMLElement): PointerCaptureSpy => {
    const state: PointerCaptureSpy = { capturedPointerId: null, events: [] };
    Object.defineProperty(element, 'setPointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            state.capturedPointerId = pointerId;
            state.events.push(`set:${pointerId}`);
        }),
    });
    Object.defineProperty(element, 'releasePointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            if (state.capturedPointerId === pointerId) {
                state.capturedPointerId = null;
            }
            state.events.push(`release:${pointerId}`);
        }),
    });
    return state;
};

const getRoot = (container: HTMLElement): HTMLElement => {
    const root = container.firstElementChild;
    if (!(root instanceof HTMLElement)) {
        throw new TypeError('Expected a RotaryKnob root');
    }
    installPointerCaptureSpy(root);
    return root;
};

const setDocumentVisibility = (state: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: state,
    });
};

const createProtocolAuthority = (): GestureAuthority => {
    let currentToken = 0;
    let currentFinalizer: (() => void) | null = null;

    return {
        acquire: (finalize: () => void) => {
            currentFinalizer?.();
            currentToken += 1;
            currentFinalizer = finalize;
            return currentToken;
        },
        isCurrent: (token) => token === currentToken,
    };
};

describe('RotaryKnob', () => {
    it('should render label', () => {
        render(<RotaryKnob value={50} onChange={vi.fn()} label="Gain" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('accepts an explicit accessible name while preserving the visible label and parameter identity', () => {
        const { container } = render(
            <RotaryKnob
                value={50}
                onChange={vi.fn()}
                label="Visible gain"
                aria-label="Input gain"
                paramId="input-gain"
            />
        );

        expect(getRoot(container)).toHaveAttribute('aria-label', 'Input gain');
        expect(screen.getByText('Visible gain')).toBeInTheDocument();
    });

    it('should reset to default on double click', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={10} onChange={onChange} defaultValue={50} min={0} max={100} />);
        fireEvent.doubleClick(getRoot(container));
        // Reset to default is a committed change, not a transient drag — isTransient is false.
        expect(onChange).toHaveBeenCalledWith(50, false);
    });

    it('does not emit a reset when the value is already the default', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} defaultValue={50} />);
        const root = getRoot(container);

        fireEvent.doubleClick(root);
        fireEvent.pointerDown(root, { button: 0, pointerId: 9, altKey: true });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('should drag and quantize value', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = getRoot(container);
        fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 1, clientY: 80 });
        fireEvent.pointerUp(root, { pointerId: 1 });
        expect(onChange).toHaveBeenCalled();
    });

    it('drops an in-flight drag when the control becomes disabled mid-gesture', () => {
        // The entry guards in `handlePointerDown` and `handleKeyDown` only stop
        // a gesture from *starting*. A knob that goes inert while the pointer
        // is already down — which is exactly what the Dutch Oven panel does
        // when automation moves the algorithm under a user's hand — kept
        // emitting transient writes and still committed on pointer-up.
        const onChange = vi.fn();
        const { container, rerender } = render(
            <RotaryKnob value={50} onChange={onChange} min={0} max={100} disabled={false} />
        );
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 11, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 11, clientY: 80 });
        expect(onChange).toHaveBeenCalled();

        onChange.mockClear();
        rerender(<RotaryKnob value={50} onChange={onChange} min={0} max={100} disabled />);

        fireEvent.pointerMove(root, { pointerId: 11, clientY: 40 });
        fireEvent.pointerUp(root, { pointerId: 11 });

        // Neither a transient nor a commit: the in-flight value is discarded,
        // the same treatment a gesture-owner change already gets.
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not commit a press and release with no value change', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 8, clientY: 100 });
        fireEvent.pointerUp(root, { pointerId: 8 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('commits the latest transient value when a drag is cancelled', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = getRoot(container);
        fireEvent.pointerDown(root, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        fireEvent.pointerCancel(root, { pointerId: 4 });

        expect(onChange.mock.calls.at(-1)).toEqual([transientValue, false]);
    });

    it('commits the latest transient value when unmounted during a drag', () => {
        const onChange = vi.fn();
        const { container, unmount } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 6, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 6, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        unmount();

        expect(onChange.mock.calls).toEqual([
            [transientValue, true],
            [transientValue, false],
        ]);
    });

    it('uses the latest owner callback when teardown finalizes the drag', () => {
        const initialOnChange = vi.fn();
        const latestOnChange = vi.fn();
        const { container, rerender, unmount } = render(
            <RotaryKnob value={50} onChange={initialOnChange} min={0} max={100} gestureOwner="stable" />
        );
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 9, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 9, clientY: 80 });
        const transientValue = initialOnChange.mock.calls.at(-1)?.[0] as number;

        rerender(
            <RotaryKnob value={transientValue} onChange={latestOnChange} min={0} max={100} gestureOwner="stable" />
        );
        unmount();

        expect(initialOnChange).toHaveBeenCalledTimes(1);
        expect(latestOnChange).toHaveBeenCalledWith(transientValue, false);
    });

    it('finalizes the previous scalar gesture before takeover and ignores its late release', () => {
        const authority = createProtocolAuthority();
        const firstOnChange = vi.fn();
        const secondOnChange = vi.fn();
        const { container } = render(
            <>
                <RotaryKnob value={50} onChange={firstOnChange} min={0} max={100} gestureAuthority={authority} />
                <RotaryKnob value={50} onChange={secondOnChange} min={0} max={100} gestureAuthority={authority} />
            </>
        );
        const [firstRoot, secondRoot] = Array.from(container.querySelectorAll<HTMLElement>('.cursor-ns-resize'));
        if (!firstRoot || !secondRoot) {
            throw new Error('Expected both rotary controls');
        }
        installPointerCaptureSpy(firstRoot);
        installPointerCaptureSpy(secondRoot);

        fireEvent.pointerDown(firstRoot, { button: 0, pointerId: 10, clientY: 100 });
        fireEvent.pointerMove(firstRoot, { pointerId: 10, clientY: 80 });
        const firstTransientCount = firstOnChange.mock.calls.length;

        fireEvent.pointerDown(secondRoot, { button: 0, pointerId: 11, clientY: 100 });
        const firstTransientValue = firstOnChange.mock.calls[0]?.[0];
        expect(firstOnChange).toHaveBeenLastCalledWith(firstTransientValue, false);
        fireEvent.pointerMove(secondRoot, { pointerId: 11, clientY: 70 });
        fireEvent.pointerMove(firstRoot, { pointerId: 10, clientY: 40 });
        fireEvent.pointerUp(firstRoot, { pointerId: 10 });
        fireEvent.pointerMove(secondRoot, { pointerId: 11, clientY: 55 });
        fireEvent.pointerUp(secondRoot, { pointerId: 11 });

        expect(firstOnChange).toHaveBeenCalledTimes(firstTransientCount + 1);
        expect(firstOnChange).toHaveBeenLastCalledWith(firstTransientValue, false);
        expect(secondOnChange.mock.calls.filter(([, isTransient]) => isTransient === false)).toHaveLength(1);
        expect(secondOnChange).toHaveBeenLastCalledWith(expect.any(Number), false);
    });

    it('does not commit again after lost pointer capture has finalized the drag', () => {
        const onChange = vi.fn();
        const { container, unmount } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
        const root = getRoot(container);
        const capture = installPointerCaptureSpy(root);

        fireEvent.pointerDown(root, { button: 0, pointerId: 7, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 7, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        capture.events.push('lost');
        fireEvent.lostPointerCapture(root, { pointerId: 7 });
        capture.events.push('pointerup');
        fireEvent.pointerUp(root, { pointerId: 7 });
        unmount();

        expect(onChange.mock.calls).toEqual([
            [transientValue, true],
            [transientValue, false],
        ]);
        expect(capture.events).toEqual(['set:7', 'lost', 'release:7', 'pointerup']);
    });

    it.each(['window blur', 'control blur', 'hidden document'])(
        'finalizes a drag on %s and allows a new gesture',
        (source) => {
            const onChange = vi.fn();
            const { container, unmount } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} />);
            const root = getRoot(container);
            const capture = installPointerCaptureSpy(root);

            fireEvent.pointerDown(root, { button: 0, pointerId: 17, clientY: 100 });
            fireEvent.pointerMove(root, { pointerId: 17, clientY: 80 });
            const firstTransientValue = onChange.mock.calls.at(-1)?.[0] as number;

            const previousVisibility = document.visibilityState;
            if (source === 'window blur') {
                fireEvent.blur(window);
            } else if (source === 'control blur') {
                fireEvent.blur(root);
            } else {
                setDocumentVisibility('hidden');
                document.dispatchEvent(new Event('visibilitychange'));
            }
            setDocumentVisibility(previousVisibility);

            expect(onChange.mock.calls).toEqual([
                [firstTransientValue, true],
                [firstTransientValue, false],
            ]);
            expect(capture.events).toEqual(['set:17', 'release:17']);

            fireEvent.lostPointerCapture(root, { pointerId: 17 });
            fireEvent.pointerUp(root, { pointerId: 17 });

            fireEvent.pointerDown(root, { button: 0, pointerId: 18, clientY: 100 });
            fireEvent.pointerMove(root, { pointerId: 18, clientY: 70 });
            const secondTransientValue = onChange.mock.calls.at(-1)?.[0] as number;
            fireEvent.pointerUp(root, { pointerId: 18 });
            unmount();

            expect(onChange.mock.calls).toEqual([
                [firstTransientValue, true],
                [firstTransientValue, false],
                [secondTransientValue, true],
                [secondTransientValue, false],
            ]);
            expect(capture.events).toEqual(['set:17', 'release:17', 'set:18', 'release:18']);
        }
    );

    it.each([
        ['pointerup', (root: HTMLElement, _unmount: () => void) => fireEvent.pointerUp(root, { pointerId: 16 })],
        [
            'pointercancel',
            (root: HTMLElement, _unmount: () => void) => fireEvent.pointerCancel(root, { pointerId: 16 }),
        ],
        [
            'lost pointer capture',
            (root: HTMLElement, _unmount: () => void) => fireEvent.lostPointerCapture(root, { pointerId: 16 }),
        ],
        ['unmount', (_root: HTMLElement, unmount: () => void) => unmount()],
    ])('does not finalize a stale drag after an authoritative replacement via %s', (_end, endGesture) => {
        const onChange = vi.fn();
        const { container, rerender, unmount } = render(
            <RotaryKnob value={50} onChange={onChange} min={0} max={100} gestureOwner="initial" />
        );
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 16, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 16, clientY: 80 });
        const transientValue = onChange.mock.calls.at(-1)?.[0] as number;

        rerender(<RotaryKnob value={20} onChange={onChange} min={0} max={100} gestureOwner="replacement" />);
        endGesture(root, unmount);

        expect(onChange.mock.calls).toEqual([[transientValue, true]]);
    });

    it('keeps the first pointer as drag owner when another pointer cancels', () => {
        const authority = createProtocolAuthority();
        const onChange = vi.fn();
        const { container } = render(
            <RotaryKnob value={50} onChange={onChange} min={0} max={100} gestureAuthority={authority} />
        );
        const root = getRoot(container);

        fireEvent.pointerDown(root, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 90 });
        fireEvent.pointerDown(root, { button: 0, pointerId: 5, clientY: 50 });
        fireEvent.pointerCancel(root, { pointerId: 5 });
        fireEvent.pointerMove(root, { pointerId: 4, clientY: 70 });
        fireEvent.pointerUp(root, { pointerId: 4 });

        expect(onChange.mock.calls).toEqual([
            [56.5, true],
            [70, true],
            [70, false],
        ]);
    });

    it('should apply shift fine mode during drag', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} min={0} max={100} step={1} />);
        const root = getRoot(container);
        fireEvent.pointerDown(root, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 2, clientY: 90, shiftKey: true });
        expect(onChange).toHaveBeenCalled();
    });

    it('exposes slider semantics and supports quantized keyboard edits', () => {
        const onChange = vi.fn();
        const { container, rerender } = render(
            <RotaryKnob value={2} onChange={onChange} min={1} max={5} step={1} fineStep={0.1} label="Gain" />
        );
        const root = getRoot(container);

        expect(root).toHaveAttribute('role', 'slider');
        expect(root).toHaveAttribute('tabindex', '0');
        expect(root).toHaveAttribute('aria-label', 'Gain');
        expect(root).toHaveAttribute('aria-valuemin', '1');
        expect(root).toHaveAttribute('aria-valuemax', '5');
        expect(root).toHaveAttribute('aria-valuenow', '2');

        fireEvent.keyDown(root, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(3, false);
        expect(onChange).toHaveBeenCalledTimes(1);

        rerender(<RotaryKnob value={3} onChange={onChange} min={1} max={5} step={1} fineStep={0.1} label="Gain" />);
        fireEvent.keyDown(getRoot(container), { key: 'ArrowDown', shiftKey: true });
        expect(onChange).toHaveBeenLastCalledWith(2.9, false);

        rerender(<RotaryKnob value={2.9} onChange={onChange} min={1} max={5} step={1} fineStep={0.1} label="Gain" />);
        fireEvent.keyDown(getRoot(container), { key: 'Home' });
        expect(onChange).toHaveBeenLastCalledWith(1, false);

        rerender(<RotaryKnob value={1} onChange={onChange} min={1} max={5} step={1} fineStep={0.1} label="Gain" />);
        fireEvent.keyDown(getRoot(container), { key: 'End' });
        expect(onChange).toHaveBeenLastCalledWith(5, false);
        expect(onChange.mock.calls.every(([, isTransient]) => isTransient === false)).toBe(true);
    });

    it('accumulates repeated keyboard edits before the controlled value rerenders', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={2} onChange={onChange} min={1} max={5} step={1} />);
        const root = getRoot(container);

        fireEvent.keyDown(root, { key: 'ArrowUp' });
        fireEvent.keyDown(root, { key: 'ArrowUp' });
        fireEvent.keyDown(root, { key: 'ArrowDown' });
        fireEvent.keyDown(root, { key: 'ArrowDown' });

        expect(onChange.mock.calls).toEqual([
            [3, false],
            [4, false],
            [3, false],
            [2, false],
        ]);
    });

    it('resynchronizes keyboard edits from an externally controlled value', () => {
        const onChange = vi.fn();
        const { container, rerender } = render(<RotaryKnob value={2} onChange={onChange} min={1} max={5} step={1} />);
        rerender(<RotaryKnob value={4} onChange={onChange} min={1} max={5} step={1} />);

        fireEvent.keyDown(getRoot(container), { key: 'ArrowUp' });

        expect(onChange).toHaveBeenCalledWith(5, false);
    });

    it('checks synchronous keyboard gesture authority and preserves pointer ownership', () => {
        let currentToken = 0;
        let allowKeyboard = true;
        let currentFinalizer: (() => void) | null = null;
        const authority: GestureAuthority = {
            acquire: vi.fn((finalize: () => void) => {
                currentFinalizer?.();
                currentToken += 1;
                currentFinalizer = finalize;
                return currentToken;
            }),
            isCurrent: vi.fn(() => allowKeyboard),
        };
        const onChange = vi.fn();
        const { container } = render(
            <RotaryKnob value={50} onChange={onChange} min={0} max={100} gestureAuthority={authority} label="Gain" />
        );
        const root = getRoot(container);
        const capture = installPointerCaptureSpy(root);

        fireEvent.keyDown(root, { key: 'ArrowUp' });
        expect(authority.acquire).toHaveBeenCalledTimes(1);
        expect(authority.isCurrent).toHaveBeenCalledWith(1);
        expect(onChange).toHaveBeenCalledWith(50.5, false);

        allowKeyboard = false;
        fireEvent.keyDown(root, { key: 'ArrowUp' });
        expect(authority.acquire).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenCalledTimes(1);

        allowKeyboard = true;
        fireEvent.pointerDown(root, { button: 0, pointerId: 19, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 19, clientY: 80 });
        fireEvent.keyDown(root, { key: 'ArrowUp' });
        fireEvent.pointerMove(root, { pointerId: 19, clientY: 70 });
        fireEvent.pointerUp(root, { pointerId: 19 });

        expect(authority.acquire).toHaveBeenCalledTimes(3);
        expect(onChange.mock.calls.filter(([, isTransient]) => isTransient === false)).toHaveLength(2);
        expect(capture.events).toEqual(['set:19', 'release:19']);
    });

    it('should ignore non-left pointer down', () => {
        const onChange = vi.fn();
        const { container } = render(<RotaryKnob value={50} onChange={onChange} />);
        const root = getRoot(container);
        fireEvent.pointerDown(root, { button: 2, pointerId: 3 });
        fireEvent.pointerMove(root, { pointerId: 3, clientY: 10 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should render a learning indicator supplied by the owning view', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} isLearning />);
        expect(container.querySelector('.border-dashed')).toBeInTheDocument();
    });

    it('should render a mapped indicator supplied by the owning view', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} isMapped />);
        expect(container.querySelector('.size-2.rounded-full')).toBeInTheDocument();
    });

    it('should delegate context-menu behavior to the owning view', () => {
        const onContextMenu = vi.fn((event: ReactMouseEvent<HTMLDivElement>) => event.preventDefault());
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} onContextMenu={onContextMenu} />);
        fireEvent.contextMenu(getRoot(container));
        expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it('lets a single arrow keystroke escape the default on a bipolar knob', () => {
        // Regression: the snap-home dead-zone was a fixed (max-min)*1% of range
        // (±0.02 here) — larger than one keyboard step (0.01). ArrowUp computed
        // 0.51, the clamp snapped it back to the 0.5 default, and the Object.is
        // guard early-returned: arrow keys alone could never move such knobs
        // off the default. Pointer drags escaped only because the raw delta
        // accumulates past the zone.
        const onChange = vi.fn();
        const { container } = render(
            <RotaryKnob value={0.5} onChange={onChange} bipolar min={-1} max={1} step={0.01} defaultValue={0.5} />
        );
        const root = getRoot(container);

        fireEvent.keyDown(root, { key: 'ArrowUp' });

        expect(onChange).toHaveBeenCalledWith(0.51, false);
    });

    it('still snaps a bipolar drag released near the default back home', () => {
        // The dead-zone shrink must not break the original intent: releasing a
        // drag near the default commits the default, not the quantized drift.
        // Default 50.3 sits off the 0.5 grid, so a release quantizing to 50.5
        // (0.2 away, inside the half-step zone) snaps home.
        const onChange = vi.fn();
        const { container } = render(
            <RotaryKnob value={60} onChange={onChange} bipolar min={0} max={100} step={0.5} defaultValue={50.3} />
        );
        const root = getRoot(container);

        // 14px down-sweep: raw = 60 - 14*(100/150) ≈ 50.67 → quantizes to 50.5
        // → inside the snap zone → 50.3.
        fireEvent.pointerDown(root, { button: 0, pointerId: 21, clientY: 100 });
        fireEvent.pointerMove(root, { pointerId: 21, clientY: 114 });
        expect(onChange).toHaveBeenLastCalledWith(50.3, true);

        fireEvent.pointerUp(root, { pointerId: 21 });
        expect(onChange).toHaveBeenLastCalledWith(50.3, false);
    });

    it('should render bipolar arc when bipolar is enabled', () => {
        const { container } = render(
            <RotaryKnob value={25} onChange={vi.fn()} bipolar min={0} max={100} defaultValue={50} />
        );
        const arc = container.querySelector('[style*="conic-gradient"]');
        expect(arc).toBeTruthy();
    });

    it('should render bipolar arc for values past center', () => {
        const { container } = render(<RotaryKnob value={75} onChange={vi.fn()} bipolar min={0} max={100} />);
        const arc = container.querySelector('[style*="conic-gradient"]');
        expect(arc).toBeTruthy();
    });

    it('should render xl size indicator dimensions', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} size="xl" />);
        const indicator = container.querySelector('[style*="12%"]');
        expect(indicator).toBeTruthy();
    });

    it('should render without label', () => {
        const { container } = render(<RotaryKnob value={50} onChange={vi.fn()} />);
        expect(container.querySelector('span')).toBeNull();
    });

    it('should render arc with every tone variant', () => {
        const tones = [
            'neutral',
            'amber',
            'cyan',
            'peach',
            'lavender',
            'mint',
            'steel',
            'danger',
            'rose',
            'indigo',
            'sage',
            'copper',
        ] as const;
        for (const tone of tones) {
            const { container, unmount } = render(
                <RotaryKnob value={50} onChange={vi.fn()} min={0} max={100} tone={tone} />
            );
            expect(container.querySelector('[style*="conic-gradient"]')).toBeTruthy();
            unmount();
        }
    });
});

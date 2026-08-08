import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, onTestFinished, vi } from 'vitest';

import { ValueField } from '../ValueField';

describe('ValueField', () => {
    it('should display rounded value and unit', () => {
        render(<ValueField value={3.456} onChange={vi.fn()} unit="%" />);
        expect(screen.getByText('3.46%')).toBeInTheDocument();
    });

    it('should call onReset on double click', () => {
        const onReset = vi.fn();
        render(<ValueField value={5} onChange={vi.fn()} onReset={onReset} />);
        fireEvent.doubleClick(screen.getByText('5'));
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('should call onChange during pointer drag after pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} step={1} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 1, clientY: 100, shiftKey: false });
        fireEvent.pointerMove(field, { pointerId: 1, clientY: 80, shiftKey: false });
        expect(onChange).toHaveBeenCalled();
    });

    it('should use fine step when shift is held during drag', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} step={1} fineStep={0.1} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 2, clientY: 90, shiftKey: true });
        expect(onChange).toHaveBeenCalled();
    });

    it('should ignore pointer move before pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} />);
        const field = screen.getByText('0');
        fireEvent.pointerMove(field, { pointerId: 9, clientY: 50 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should ignore non-left pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 1, pointerId: 3 });
        fireEvent.pointerMove(field, { pointerId: 3, clientY: 10 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should render label when provided', () => {
        render(<ValueField value={1} onChange={vi.fn()} label="Amount" />);
        expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    it('should not call onReset when double click without onReset', () => {
        const onChange = vi.fn();
        render(<ValueField value={5} onChange={onChange} />);
        fireEvent.doubleClick(screen.getByText('5'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should not scrub or reset when read-only', () => {
        const onChange = vi.fn();
        const onReset = vi.fn();
        render(<ValueField value={0} onChange={onChange} onReset={onReset} readOnly min={-10} max={10} step={1} />);
        const field = screen.getByText('0');

        fireEvent.pointerDown(field, { button: 0, pointerId: 11, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 11, clientY: 60 });
        fireEvent.doubleClick(field);

        expect(onChange).not.toHaveBeenCalled();
        expect(onReset).not.toHaveBeenCalled();
        expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should expose the readout as a widget so its name, value and read-only state map to ARIA', () => {
        // `aria-readonly` and `aria-label` on a role-less div have no ARIA
        // mapping and are dropped outright: the lock survived only as dim text
        // and a `cursor-default`, i.e. for sighted mouse users.
        render(<ValueField value={90} onChange={vi.fn()} ariaLabel="Tempo BPM" min={20} max={999} unit=" BPM" />);
        const field = screen.getByRole('spinbutton', { name: 'Tempo BPM' });

        expect(field).toHaveAttribute('aria-valuenow', '90');
        expect(field).toHaveAttribute('aria-valuemin', '20');
        expect(field).toHaveAttribute('aria-valuemax', '999');
        expect(field).toHaveAttribute('aria-valuetext', '90 BPM');
        expect(field).toHaveAttribute('aria-readonly', 'false');
    });

    it('should mark the widget read-only when it is, rather than only dimming it', () => {
        render(<ValueField value={90} onChange={vi.fn()} ariaLabel="Tempo BPM" readOnly />);

        expect(screen.getByRole('spinbutton', { name: 'Tempo BPM' })).toHaveAttribute('aria-readonly', 'true');
    });

    it('should adjust by keyboard, since the field was unreachable without a pointer', () => {
        const onChange = vi.fn();
        render(
            <ValueField value={5} onChange={onChange} ariaLabel="Amount" min={0} max={10} step={1} fineStep={0.1} />
        );
        const field = screen.getByRole('spinbutton', { name: 'Amount' });

        expect(field).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(field, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenLastCalledWith(6);

        fireEvent.keyDown(field, { key: 'ArrowDown' });
        expect(onChange).toHaveBeenLastCalledWith(4);

        fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
        expect(onChange).toHaveBeenLastCalledWith(5.1);

        fireEvent.keyDown(field, { key: 'Home' });
        expect(onChange).toHaveBeenLastCalledWith(0);

        fireEvent.keyDown(field, { key: 'End' });
        expect(onChange).toHaveBeenLastCalledWith(10);
    });

    it('should ignore keyboard adjustment when read-only', () => {
        const onChange = vi.fn();
        render(<ValueField value={5} onChange={onChange} ariaLabel="Amount" min={0} max={10} step={1} readOnly />);

        fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Amount' }), { key: 'ArrowUp' });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('should leave unrelated keys to the page instead of swallowing them', () => {
        const onChange = vi.fn();
        render(<ValueField value={5} onChange={onChange} ariaLabel="Amount" min={0} max={10} step={1} />);

        fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Amount' }), { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('should report once on release in release mode, not on every move', () => {
        const onChange = vi.fn();
        render(
            <ValueField value={0} onChange={onChange} commitMode="release" min={-100} max={100} step={1} unit="u" />
        );
        const field = screen.getByText('0u');

        fireEvent.pointerDown(field, { button: 0, pointerId: 12, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 12, clientY: 90 });
        fireEvent.pointerMove(field, { pointerId: 12, clientY: 80 });
        // Mid-drag the field shows the scrubbed value locally, having reported
        // nothing: one undoable command per pointer move is not a history.
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('10u')).toBeInTheDocument();

        fireEvent.pointerUp(field, { pointerId: 12 });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(10);
    });

    it('should report nothing on release in release mode when the pointer never moved', () => {
        const onChange = vi.fn();
        render(<ValueField value={4} onChange={onChange} commitMode="release" />);
        const field = screen.getByText('4');

        fireEvent.pointerDown(field, { button: 0, pointerId: 13, clientY: 100 });
        fireEvent.pointerUp(field, { pointerId: 13 });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('should end drag on pointer up', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 4, clientY: 90 });
        fireEvent.pointerUp(field, { pointerId: 4 });
        onChange.mockClear();
        fireEvent.pointerMove(field, { pointerId: 4, clientY: 80 });
        expect(onChange).not.toHaveBeenCalled();
    });

    /**
     * ADR 0012 — the capture calls used to sit behind `typeof … === 'function'`
     * probes whose false branch no shipped engine can take. All the probe could
     * do was convert a missing capture into a scrub that silently stops
     * updating once the pointer leaves the field's box.
     *
     * These assert the *call sites*, not the effect: `src/setupTests.ts` stubs
     * both methods as no-ops and jsdom implements no capture semantics, so
     * nothing here proves that pointer events are actually retargeted. It
     * proves the element is asked to take capture when a scrub starts, is asked
     * to give it back when the scrub ends, and is not asked at all for a press
     * that never becomes a scrub.
     */
    describe('pointer capture call sites', () => {
        type CaptureSpy = {
            field: HTMLElement;
            calls: string[];
            /** Messages of DOMExceptions that escaped a React handler to the window. */
            uncaught: string[];
        };

        /**
         * The spy replaces `src/setupTests.ts`'s no-op capture stubs for this
         * block. Unlike them it can *fail*: `releasePointerCapture` raises
         * `NotFoundError` when `pointerId` matches no pointer this element has
         * captured, which is the one rule the Pointer Events spec gives it and
         * the one a no-op stub can never express.
         *
         * A React handler that throws does not propagate out of `fireEvent` —
         * jsdom reports it as an uncaught error on the window — so `uncaught`
         * is where the DOMException shows up, exactly as it does in Chromium.
         */
        const renderWithCaptureSpy = (readOnly = false): CaptureSpy => {
            render(<ValueField value={0} onChange={vi.fn()} min={-10} max={10} readOnly={readOnly} />);
            const field = screen.getByRole('spinbutton');
            const calls: string[] = [];
            const captured = new Set<number>();
            Object.defineProperty(field, 'setPointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    calls.push(`set:${pointerId}`);
                    captured.add(pointerId);
                },
            });
            Object.defineProperty(field, 'releasePointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    // Recorded before the throw: a release that raises is still a
                    // release the component asked for, and that ask is the defect.
                    calls.push(`release:${pointerId}`);
                    if (!captured.has(pointerId)) {
                        throw new DOMException(`No active pointer with id ${pointerId}`, 'NotFoundError');
                    }
                    captured.delete(pointerId);
                },
            });
            const uncaught: string[] = [];
            const handleWindowError = (event: ErrorEvent): void => {
                uncaught.push(String(event.message));
            };
            window.addEventListener('error', handleWindowError);
            onTestFinished(() => {
                window.removeEventListener('error', handleWindowError);
            });
            return { field, calls, uncaught };
        };

        it('should take capture on pointer down and give it back on pointer up', () => {
            const { field, calls, uncaught } = renderWithCaptureSpy();
            fireEvent.pointerDown(field, { button: 0, pointerId: 21, clientY: 100 });
            expect(calls).toEqual(['set:21']);
            fireEvent.pointerUp(field, { pointerId: 21 });
            // A drag that captured must still hand the capture back — guarding the
            // release must not become "never release", which leaks the capture and
            // leaves every later pointermove on the page retargeted to this field.
            expect(calls).toEqual(['set:21', 'release:21']);
            expect(uncaught).toEqual([]);
        });

        it('should take no capture when the field is read-only', () => {
            const { field, calls } = renderWithCaptureSpy(true);
            fireEvent.pointerDown(field, { button: 0, pointerId: 22, clientY: 100 });
            expect(calls).toEqual([]);
        });

        it('should take no capture when the press is not the primary button', () => {
            const { field, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(field, { button: 2, pointerId: 23, clientY: 100 });
            expect(calls).toEqual([]);
        });

        it('should not release a capture it never took when the press was read-only', () => {
            const { field, calls, uncaught } = renderWithCaptureSpy(true);

            fireEvent.pointerDown(field, { button: 0, pointerId: 24, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 24 });

            expect(calls).toEqual([]);
            expect(uncaught).toEqual([]);
        });

        it('should not release a capture it never took when the press was a right-click', () => {
            const { field, calls, uncaught } = renderWithCaptureSpy();

            fireEvent.pointerDown(field, { button: 2, pointerId: 25, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 25 });

            expect(calls).toEqual([]);
            expect(uncaught).toEqual([]);
        });

        it('should survive a release the browser has already performed', () => {
            // Mid-drag the capture goes away on its own — the browser releases it
            // implicitly, or a second pointer's `pointerup` arrives. The release
            // is still reached, so the guard alone does not cover this: only the
            // `catch` keeps the stale id from raising `NotFoundError`.
            const { field, calls, uncaught } = renderWithCaptureSpy();

            fireEvent.pointerDown(field, { button: 0, pointerId: 26, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 27 });

            expect(calls).toEqual(['set:26', 'release:27']);
            expect(uncaught).toEqual([]);
        });
    });
});

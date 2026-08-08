import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
     * A drag belongs to one pointer. These cover the id bookkeeping: which
     * pointer may scrub, which pointer may end the scrub, and which id is
     * handed back to the browser.
     *
     * They assert the *call sites*, not the effect: `src/setupTests.ts` stubs
     * both capture methods as no-ops and jsdom implements no capture semantics,
     * so nothing here proves that pointer events are actually retargeted.
     */
    describe('pointer capture call sites', () => {
        /**
         * Replaces `src/setupTests.ts`'s no-op capture stubs for this block, and
         * unlike them it can fail — but only where the platform actually fails.
         *
         * `releasePointerCapture` throws `NotFoundError` when the id matches no
         * *active pointer*; when the element merely holds no capture for an
         * active id, the algorithm terminates silently. Measured in Chromium via
         * Playwright: a right-click `pointerup` on an element that never captured
         * releases cleanly, a touch `pointerup` reports `hasCapture=true` from
         * implicit capture and releases cleanly, and only an id never seen as a
         * pointer at all throws. So the spy tracks *active* ids, not captured
         * ones — modelling it the other way invents an exception the platform
         * does not raise.
         */
        const renderWithCaptureSpy = (readOnly = false): { field: HTMLElement; calls: string[] } => {
            render(<ValueField value={0} onChange={vi.fn()} min={-10} max={10} readOnly={readOnly} />);
            const field = screen.getByRole('spinbutton');
            const calls: string[] = [];
            // Any id delivering any pointer event is, at that moment, an active
            // pointer — which is why the component can never make the release
            // throw. Registered at the target, so it lands before React's
            // delegated handler at the root container runs.
            const activePointers = new Set<number>();
            for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
                field.addEventListener(type, (event: Event): void => {
                    activePointers.add((event as globalThis.PointerEvent).pointerId);
                });
            }
            Object.defineProperty(field, 'setPointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    calls.push(`set:${pointerId}`);
                },
            });
            Object.defineProperty(field, 'releasePointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    if (!activePointers.has(pointerId)) {
                        throw new DOMException(`No active pointer with id ${pointerId}`, 'NotFoundError');
                    }
                    calls.push(`release:${pointerId}`);
                },
            });
            return { field, calls };
        };

        it('should take capture on pointer down and give it back on pointer up', () => {
            const { field, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(field, { button: 0, pointerId: 21, clientY: 100 });
            expect(calls).toEqual(['set:21']);
            fireEvent.pointerUp(field, { pointerId: 21 });
            // Skipping a release must not become "never release": that leaks the
            // capture and leaves later pointer events retargeted to this field.
            expect(calls).toEqual(['set:21', 'release:21']);
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

        it('should not ask to release a capture it never took, on a read-only press', () => {
            const { field, calls } = renderWithCaptureSpy(true);

            fireEvent.pointerDown(field, { button: 0, pointerId: 24, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 24 });

            expect(calls).toEqual([]);
        });

        it('should not ask to release a capture it never took, on a right-click', () => {
            const { field, calls } = renderWithCaptureSpy();

            fireEvent.pointerDown(field, { button: 2, pointerId: 25, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 25 });

            expect(calls).toEqual([]);
        });

        it('should release the pointer it captured, not the one that happened to lift', () => {
            const { field, calls } = renderWithCaptureSpy();

            fireEvent.pointerDown(field, { button: 0, pointerId: 26, clientY: 100 });
            fireEvent.pointerDown(field, { button: 2, pointerId: 27, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 27 });
            expect(calls).toEqual(['set:26']);

            fireEvent.pointerUp(field, { pointerId: 26 });
            expect(calls).toEqual(['set:26', 'release:26']);
        });
    });

    describe('a drag belongs to the pointer that started it', () => {
        it('should keep scrubbing after a second pointer lifts', () => {
            const onChange = vi.fn();
            render(<ValueField value={0} onChange={onChange} min={-100} max={100} step={1} />);
            const field = screen.getByRole('spinbutton');

            fireEvent.pointerDown(field, { button: 0, pointerId: 31, clientY: 100 });
            // A second finger touches down and lifts mid-drag. It never owned the
            // drag, so it must not end it.
            fireEvent.pointerDown(field, { button: 2, pointerId: 32, clientY: 100 });
            fireEvent.pointerUp(field, { pointerId: 32 });

            fireEvent.pointerMove(field, { pointerId: 31, clientY: 80 });

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenLastCalledWith(10);
        });

        it('should ignore movement from a pointer that does not own the drag', () => {
            const onChange = vi.fn();
            render(<ValueField value={0} onChange={onChange} min={-100} max={100} step={1} />);
            const field = screen.getByRole('spinbutton');

            fireEvent.pointerDown(field, { button: 0, pointerId: 33, clientY: 100 });
            fireEvent.pointerMove(field, { pointerId: 34, clientY: 20 });

            expect(onChange).not.toHaveBeenCalled();

            fireEvent.pointerMove(field, { pointerId: 33, clientY: 90 });
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenLastCalledWith(5);
        });

        it('should commit once on release in release mode, ignoring a foreign pointer up', () => {
            const onChange = vi.fn();
            render(<ValueField value={0} onChange={onChange} commitMode="release" min={-100} max={100} step={1} />);
            const field = screen.getByRole('spinbutton');

            fireEvent.pointerDown(field, { button: 0, pointerId: 35, clientY: 100 });
            fireEvent.pointerMove(field, { pointerId: 35, clientY: 80 });
            fireEvent.pointerUp(field, { pointerId: 36 });

            expect(onChange).not.toHaveBeenCalled();

            fireEvent.pointerUp(field, { pointerId: 35 });

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(10);
        });
    });
});

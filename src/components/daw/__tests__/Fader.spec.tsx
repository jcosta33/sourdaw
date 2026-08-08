import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { Fader } from '../Fader';

describe('Fader', () => {
    let getBoundingClientRectSpy: MockInstance;

    beforeEach(() => {
        getBoundingClientRectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            width: 40,
            height: 100,
            top: 0,
            left: 0,
            right: 40,
            bottom: 100,
            toJSON: (): void => {},
        });
    });

    afterEach(() => {
        getBoundingClientRectSpy.mockRestore();
    });

    it('should reset to default on double click', () => {
        const onChange = vi.fn();
        const { container } = render(<Fader value={-10} onChange={onChange} defaultValue={0} min={-70} max={6} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.doubleClick(root);
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it('should render dB scale when showScale is true', () => {
        render(<Fader value={0} onChange={vi.fn()} showScale />);
        expect(screen.getByText('+6')).toBeInTheDocument();
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });

    it('should jump to value when pointer down hits track outside cap', () => {
        const onChange = vi.fn();
        const { container } = render(<Fader value={-70} onChange={onChange} min={-70} max={6} height={100} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, {
            button: 0,
            pointerId: 1,
            clientY: 50,
            clientX: 20,
            bubbles: true,
        });
        expect(onChange).toHaveBeenCalled();
    });

    it('should ignore non-left pointer down', () => {
        const onChange = vi.fn();
        const { container } = render(<Fader value={0} onChange={onChange} min={-70} max={6} />);
        const root = container.firstChild as HTMLElement;
        fireEvent.pointerDown(root, { button: 2, pointerId: 1, clientY: 0 });
        fireEvent.pointerMove(root, { pointerId: 1, clientY: 10 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should drag from cap and apply shift fine mode', () => {
        const onChange = vi.fn();
        const { container } = render(<Fader value={0} onChange={onChange} min={-70} max={6} fineStep={0.1} />);
        const root = container.firstChild as HTMLElement;
        const cap = root.querySelector('[data-role="fader-cap"]') as HTMLElement;
        fireEvent.pointerDown(cap, { button: 0, pointerId: 2, clientY: 100, clientX: 0 });
        fireEvent.pointerMove(root, { pointerId: 2, clientY: 90, shiftKey: true });
        fireEvent.pointerUp(root, { pointerId: 2 });
        expect(onChange).toHaveBeenCalled();
    });

    it('should snap toward default when bipolar near center', () => {
        const onChange = vi.fn();
        const { container } = render(
            <Fader value={0.1} onChange={onChange} bipolar defaultValue={0} min={-10} max={10} step={0.5} />
        );
        const root = container.firstChild as HTMLElement;
        const cap = root.querySelector('[data-role="fader-cap"]') as HTMLElement;
        fireEvent.pointerDown(cap, { button: 0, pointerId: 3, clientY: 50 });
        fireEvent.pointerMove(root, { pointerId: 3, clientY: 50.1 });
        fireEvent.pointerUp(root, { pointerId: 3 });
        expect(onChange).toHaveBeenCalled();
    });

    it('should use tone classes on cap groove when dragging', () => {
        const onChange = vi.fn();
        const { container } = render(<Fader value={0} onChange={onChange} min={-70} max={6} tone="amber" />);
        const root = container.firstChild as HTMLElement;
        const cap = root.querySelector('[data-role="fader-cap"]') as HTMLElement;
        fireEvent.pointerDown(cap, { button: 0, pointerId: 4, clientY: 40 });
        const grooves = cap.querySelectorAll('div');
        expect(grooves.length).toBeGreaterThan(0);
        fireEvent.pointerUp(root, { pointerId: 4 });
        expect(onChange).not.toHaveBeenCalled();
    });

    // audit M-083 — the root was a bare div: no role, no value, no name, no focus.
    describe('assistive-technology contract (audit M-083)', () => {
        it('should expose the slider role carrying its value and bounds', () => {
            render(<Fader value={-10} onChange={vi.fn()} min={-70} max={6} />);
            const slider = screen.getByRole('slider');
            expect(slider).toHaveAttribute('aria-valuenow', '-10');
            expect(slider).toHaveAttribute('aria-valuemin', '-70');
            expect(slider).toHaveAttribute('aria-valuemax', '6');
            expect(slider).toHaveAttribute('aria-orientation', 'vertical');
        });

        it('should clamp the reported value into the declared bounds', () => {
            render(<Fader value={99} onChange={vi.fn()} min={-70} max={6} />);
            expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '6');
        });

        it('should take its accessible name from the aria-label prop', () => {
            render(<Fader value={0} onChange={vi.fn()} aria-label="Master gain" />);
            expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveAttribute('aria-valuenow', '0');
        });

        it('should announce a unit-qualified value when a unit is supplied', () => {
            render(<Fader value={-10} onChange={vi.fn()} min={-70} max={6} unit="dB" />);
            expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '-10 dB');
        });

        it('should omit aria-valuetext when no unit is supplied', () => {
            render(<Fader value={-10} onChange={vi.fn()} min={-70} max={6} />);
            expect(screen.getByRole('slider')).not.toHaveAttribute('aria-valuetext');
        });

        it('should be reachable by keyboard focus', () => {
            render(<Fader value={0} onChange={vi.fn()} />);
            const slider = screen.getByRole('slider');
            slider.focus();
            expect(document.activeElement).toBe(slider);
        });
    });

    // audit M-083 — APG slider keys: arrows step, Home/End bound, PageUp/PageDown coarse.
    describe('keyboard control (audit M-083)', () => {
        const renderFader = (value: number): ReturnType<typeof vi.fn> => {
            const onChange = vi.fn();
            render(<Fader value={value} onChange={onChange} min={-70} max={6} step={0.5} fineStep={0.1} />);
            return onChange;
        };

        it('should raise the value by one step on ArrowUp', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
            expect(onChange).toHaveBeenCalledWith(-9.5);
        });

        it('should raise the value by one step on ArrowRight', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
            expect(onChange).toHaveBeenCalledWith(-9.5);
        });

        it('should lower the value by one step on ArrowDown', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown' });
            expect(onChange).toHaveBeenCalledWith(-10.5);
        });

        it('should lower the value by one step on ArrowLeft', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
            expect(onChange).toHaveBeenCalledWith(-10.5);
        });

        it('should use the fine step while shift is held', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp', shiftKey: true });
            expect(onChange).toHaveBeenCalledWith(-9.9);
        });

        it('should jump to the minimum on Home and the maximum on End', () => {
            const onChange = renderFader(-10);
            const slider = screen.getByRole('slider');
            fireEvent.keyDown(slider, { key: 'Home' });
            expect(onChange).toHaveBeenCalledWith(-70);
            fireEvent.keyDown(slider, { key: 'End' });
            expect(onChange).toHaveBeenCalledWith(6);
        });

        it('should move a coarse step on PageUp and PageDown', () => {
            const onChange = renderFader(-10);
            const slider = screen.getByRole('slider');
            fireEvent.keyDown(slider, { key: 'PageUp' });
            expect(onChange).toHaveBeenCalledWith(-5);
            fireEvent.keyDown(slider, { key: 'PageDown' });
            expect(onChange).toHaveBeenCalledWith(-15);
        });

        it('should quantise a keyboard step onto the step grid without float residue', () => {
            const onChange = vi.fn();
            // `Math.round(5.1 / 0.1) * 0.1` is 5.1000000000000005 — invisible in the
            // readout, permanent in the project. The emitted value must be exactly 5.1.
            render(<Fader value={5} onChange={onChange} min={0} max={10} step={0.1} />);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
            expect(onChange).toHaveBeenCalledWith(5.1);
        });

        it('should not emit a change when already at the bound', () => {
            const onChange = renderFader(6);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowUp' });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should ignore keys outside the slider contract', () => {
            const onChange = renderFader(-10);
            fireEvent.keyDown(screen.getByRole('slider'), { key: 'a' });
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    // audit M-082 — a drag that ends by anything other than pointerup left draggingRef
    // stuck true, so plain hover afterwards kept writing the value.
    describe('drag finalization (audit M-082)', () => {
        const startDrag = (): { slider: HTMLElement; onChange: ReturnType<typeof vi.fn> } => {
            const onChange = vi.fn();
            render(<Fader value={0} onChange={onChange} min={-70} max={6} height={100} />);
            const slider = screen.getByRole('slider');
            const cap = slider.querySelector('[data-role="fader-cap"]') as HTMLElement;
            fireEvent.pointerDown(cap, { button: 0, pointerId: 7, clientY: 50 });
            onChange.mockClear();
            return { slider, onChange };
        };

        it('should stop tracking the pointer after pointercancel', () => {
            const { slider, onChange } = startDrag();
            fireEvent.pointerCancel(slider, { pointerId: 7 });
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should stop tracking the pointer after capture is lost', () => {
            const { slider, onChange } = startDrag();
            fireEvent.lostPointerCapture(slider, { pointerId: 7 });
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should stop tracking the pointer when the window loses focus mid-drag', () => {
            const { slider, onChange } = startDrag();
            fireEvent(window, new Event('blur'));
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should stop tracking the pointer when the document is hidden mid-drag', () => {
            const { slider, onChange } = startDrag();
            const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
            fireEvent(document, new Event('visibilitychange'));
            visibility.mockRestore();
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should stop tracking the pointer when focus leaves the control mid-drag', () => {
            const { slider, onChange } = startDrag();
            fireEvent.blur(slider);
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).not.toHaveBeenCalled();
        });

        it('should keep dragging while the pointer is still down', () => {
            const { slider, onChange } = startDrag();
            fireEvent.pointerMove(slider, { pointerId: 7, clientY: 10 });
            expect(onChange).toHaveBeenCalledWith(6);
        });
    });

    /**
     * ADR 0012 — the capture calls used to sit behind `typeof … === 'function'`
     * probes. Every engine this app ships on implements `setPointerCapture`, so
     * the false branch was unreachable; all it could ever do was turn a missing
     * capture into a drag that silently breaks at the element edge.
     *
     * These assert the *call sites*, not the effect. `src/setupTests.ts` stubs
     * both methods as no-ops for jsdom, and jsdom has no capture implementation
     * of its own, so no test in this repo can prove capture actually retargets
     * events to the fader. What is provable, and what regressed without these,
     * is that the element is asked to take capture on `pointerdown` and asked to
     * give it back on every path a drag can end by.
     */
    describe('pointer capture call sites', () => {
        const installPointerCaptureSpy = (element: HTMLElement): string[] => {
            const calls: string[] = [];
            Object.defineProperty(element, 'setPointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    calls.push(`set:${pointerId}`);
                },
            });
            Object.defineProperty(element, 'releasePointerCapture', {
                configurable: true,
                value: (pointerId: number): void => {
                    calls.push(`release:${pointerId}`);
                },
            });
            return calls;
        };

        const renderWithCaptureSpy = (): { slider: HTMLElement; calls: string[] } => {
            render(<Fader value={0} onChange={vi.fn()} defaultValue={0} min={-70} max={6} height={100} />);
            const slider = screen.getByRole('slider');
            return { slider, calls: installPointerCaptureSpy(slider) };
        };

        it('should take capture on pointer down and give it back on pointer up', () => {
            const { slider, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(slider, { button: 0, pointerId: 7, clientY: 50, clientX: 20 });
            expect(calls).toEqual(['set:7']);
            fireEvent.pointerUp(slider, { pointerId: 7 });
            expect(calls).toEqual(['set:7', 'release:7']);
        });

        it('should give capture back when the drag ends by pointercancel', () => {
            const { slider, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(slider, { button: 0, pointerId: 8, clientY: 50, clientX: 20 });
            fireEvent.pointerCancel(slider, { pointerId: 8 });
            expect(calls).toEqual(['set:8', 'release:8']);
        });

        it('should give capture back when the window loses focus mid-drag', () => {
            const { slider, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(slider, { button: 0, pointerId: 9, clientY: 50, clientX: 20 });
            fireEvent(window, new Event('blur'));
            expect(calls).toEqual(['set:9', 'release:9']);
        });

        it('should take no capture when the press is not the primary button', () => {
            const { slider, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(slider, { button: 2, pointerId: 10, clientY: 50, clientX: 20 });
            expect(calls).toEqual([]);
        });

        it('should take no capture when an alt-press resets to the default instead of dragging', () => {
            const { slider, calls } = renderWithCaptureSpy();
            fireEvent.pointerDown(slider, { button: 0, pointerId: 11, clientY: 50, clientX: 20, altKey: true });
            expect(calls).toEqual([]);
        });
    });

    it('should apply every tone variant while dragging', () => {
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
            const onChange = vi.fn();
            const { container, unmount } = render(
                <Fader value={0} onChange={onChange} min={-70} max={6} tone={tone} />
            );
            const root = container.firstChild as HTMLElement;
            const cap = root.querySelector('[data-role="fader-cap"]') as HTMLElement;
            fireEvent.pointerDown(cap, { button: 0, pointerId: 10, clientY: 40 });
            fireEvent.pointerUp(root, { pointerId: 10 });
            unmount();
        }
    });
});

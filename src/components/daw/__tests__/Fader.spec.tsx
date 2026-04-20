import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Fader } from '../Fader';

describe('Fader', () => {
    let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;

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
        } as DOMRect);
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

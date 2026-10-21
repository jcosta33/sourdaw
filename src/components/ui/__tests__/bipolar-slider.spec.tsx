import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BipolarSlider } from '../bipolar-slider';

describe('BipolarSlider', () => {
    it('maps a typed numeric final value into domain units and commits once', () => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        render(
            <BipolarSlider
                value={-20}
                onValueChange={onValueChange}
                onValueCommit={onValueCommit}
                min={-60}
                max={0}
                aria-label="Threshold"
            />
        );
        fireEvent.doubleClick(screen.getByRole('slider', { name: 'Threshold' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '50' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
        fireEvent.blur(screen.getByRole('slider', { name: 'Threshold' }));
        expect(onValueChange).toHaveBeenCalledWith(-30);
        expect(onValueCommit.mock.calls).toEqual([[-30]]);
    });

    it('settles a keyboard edit once before a later blur', () => {
        const onValueCommit = vi.fn();
        render(<BipolarSlider value={0} onValueChange={vi.fn()} onValueCommit={onValueCommit} min={-1} max={1} />);
        const slider = screen.getByRole('slider', { name: 'Bipolar value' });
        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        fireEvent.blur(slider);
        expect(onValueCommit).toHaveBeenCalledTimes(1);
        expect(onValueCommit).toHaveBeenCalledWith(expect.any(Number));
    });

    it.each(['metaKey', 'ctrlKey'])('commits a %s reset once without a later ghost commit', (modifier) => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        render(
            <BipolarSlider value={0.5} onValueChange={onValueChange} onValueCommit={onValueCommit} min={-1} max={1} />
        );
        const slider = screen.getByRole('slider', { name: 'Bipolar value' });
        fireEvent.pointerDown(slider, { pointerId: 1, [modifier]: true });
        fireEvent.blur(slider);
        fireEvent.blur(window);
        expect(onValueChange.mock.calls).toEqual([[0]]);
        expect(onValueCommit.mock.calls).toEqual([[0]]);
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'unmount'])(
        'settles the latest pointer sample once on %s', (finish) => {
            const onValueCommit = vi.fn();
            const view = render(<BipolarSlider value={0} onValueChange={vi.fn()} onValueCommit={onValueCommit} min={-1} max={1} />);
            const root = screen.getByRole('slider', { name: 'Bipolar value' }).closest('[data-slot="slider"]');
            if (!(root instanceof HTMLElement)) throw new Error('Missing Slider root');
            Object.defineProperties(root, {
                setPointerCapture: { configurable: true, value: vi.fn() },
                releasePointerCapture: { configurable: true, value: vi.fn() },
                hasPointerCapture: { configurable: true, value: () => true },
            });
            vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, toJSON: () => ({}) });
            fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
            fireEvent.pointerMove(root, { pointerId: 1, clientX: 80, clientY: 10 });
            if (finish === 'pointerCancel') fireEvent.pointerCancel(root, { pointerId: 1 });
            else if (finish === 'lostPointerCapture') fireEvent.lostPointerCapture(root, { pointerId: 1 });
            else if (finish === 'windowBlur') fireEvent.blur(window);
            else view.unmount();
            fireEvent.pointerUp(root, { pointerId: 1 });
            expect(onValueCommit).toHaveBeenCalledTimes(1);
            expect(onValueCommit.mock.calls[0]![0]).toBeCloseTo(0.6);
        }
    );

    it('uses an explicit accessible name when no visual label is provided', () => {
        render(
            <BipolarSlider value={0.5} onValueChange={vi.fn()} min={0} max={1} step={0.01} aria-label="Output gain" />
        );

        expect(screen.getByRole('slider', { name: 'Output gain' })).toBeInTheDocument();
    });

    it('should show label and formatted value when label is set', () => {
        const onValueChange = vi.fn();
        render(
            <BipolarSlider
                label="Width"
                value={0}
                onValueChange={onValueChange}
                min={-1}
                max={1}
                formatValue={(v) => v.toFixed(2)}
            />
        );
        expect(screen.getByText('Width')).toBeInTheDocument();
        expect(screen.getByText('0.00')).toBeInTheDocument();
    });

    it('should reset value on meta+pointer down on track wrapper', () => {
        const onValueChange = vi.fn();
        render(<BipolarSlider value={0.5} onValueChange={onValueChange} min={-1} max={1} defaultValue={0} />);
        const wrapper = screen.getByRole('slider', { name: 'Bipolar value' }).parentElement?.parentElement;
        expect(wrapper).not.toBeNull();
        fireEvent.pointerDown(wrapper as HTMLElement, { pointerId: 1, metaKey: true });
        expect(onValueChange).toHaveBeenCalledWith(0);
    });

    it('should reset value on ctrl+pointer down on track wrapper', () => {
        const onValueChange = vi.fn();
        render(<BipolarSlider value={0.5} onValueChange={onValueChange} min={-1} max={1} defaultValue={0} />);
        const wrapper = screen.getByRole('slider', { name: 'Bipolar value' }).parentElement?.parentElement;
        expect(wrapper).not.toBeNull();
        fireEvent.pointerDown(wrapper as HTMLElement, { pointerId: 1, ctrlKey: true });
        expect(onValueChange).toHaveBeenCalledWith(0);
    });

    it('should render without label and show centered readout', () => {
        const onValueChange = vi.fn();
        render(<BipolarSlider value={0.2} onValueChange={onValueChange} min={-1} max={1} />);
        expect(screen.queryByText('Width')).not.toBeInTheDocument();
        expect(screen.getByText('0.2')).toBeInTheDocument();
    });

    it('should use fallback step when step is not positive', () => {
        const onValueChange = vi.fn();
        const { container } = render(
            <BipolarSlider value={0} onValueChange={onValueChange} min={-1} max={1} step={0} />
        );
        expect(container.querySelector('[data-slot="slider"]')).toBeInTheDocument();
    });

    it('should normalize to center when min equals max', () => {
        const onValueChange = vi.fn();
        render(<BipolarSlider value={0} onValueChange={onValueChange} min={0} max={0} />);
        expect(screen.getByRole('slider', { name: 'Bipolar value' })).toBeInTheDocument();
    });
});

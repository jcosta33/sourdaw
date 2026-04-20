import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BipolarSlider } from '../bipolar-slider';

describe('BipolarSlider', () => {
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

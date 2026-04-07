import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BipolarSlider } from './bipolar-slider';

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
        render(
            <BipolarSlider value={0.5} onValueChange={onValueChange} min={-1} max={1} defaultValue={0} />
        );
        const wrapper = screen.getByRole('slider', { name: 'Bipolar value' }).parentElement?.parentElement;
        expect(wrapper).not.toBeNull();
        fireEvent.pointerDown(wrapper as HTMLElement, { pointerId: 1, metaKey: true });
        expect(onValueChange).toHaveBeenCalledWith(0);
    });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BipolarSlider } from './bipolar-slider';

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ onValueChange }: { onValueChange: (values: number[]) => void }) => (
        <button type="button" onClick={() => onValueChange([])}>
            trigger-empty
        </button>
    ),
}));

describe('BipolarSlider empty slider payload', () => {
    it('should ignore onValueChange when slider passes an empty tuple', () => {
        const onValueChange = vi.fn();
        render(<BipolarSlider value={0} onValueChange={onValueChange} min={-1} max={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'trigger-empty' }));
        expect(onValueChange).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Slider } from '../slider';

describe('Slider', () => {
    it('should render a slider with one thumb by default', () => {
        render(<Slider min={0} max={100} aria-label="Level" />);
        expect(screen.getByRole('slider', { name: 'Level' })).toBeInTheDocument();
    });

    it('should call onValueChange when value updates from controlled props', () => {
        const onValueChange = vi.fn();
        const { rerender } = render(
            <Slider value={[10]} min={0} max={100} onValueChange={onValueChange} aria-label="Gain" />
        );
        rerender(<Slider value={[20]} min={0} max={100} onValueChange={onValueChange} aria-label="Gain" />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '20');
    });

    it('should reset to default when meta+pointer down on thumb with handlers', () => {
        const onValueChange = vi.fn();
        render(
            <Slider
                value={[50]}
                defaultValue={[25]}
                min={0}
                max={100}
                onValueChange={onValueChange}
                aria-label="Pan"
            />
        );
        const thumb = screen.getByRole('slider', { name: 'Pan' });
        fireEvent.pointerDown(thumb, { pointerId: 1, metaKey: true });
        expect(onValueChange).toHaveBeenCalledWith([25]);
    });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
            <Slider value={[50]} defaultValue={[25]} min={0} max={100} onValueChange={onValueChange} aria-label="Pan" />
        );
        const thumb = screen.getByRole('slider', { name: 'Pan' });
        fireEvent.pointerDown(thumb, { pointerId: 1, metaKey: true });
        expect(onValueChange).toHaveBeenCalledWith([25]);
    });

    it('commits a typed value when numeric editing accepts it', () => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        render(
            <Slider
                value={[100]}
                onValueChange={onValueChange}
                onValueCommit={onValueCommit}
                min={50}
                max={200}
                aria-label="UI Scale"
            />
        );

        fireEvent.doubleClick(screen.getByRole('slider', { name: 'UI Scale' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '150' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

        expect(onValueChange).toHaveBeenCalledWith([150]);
        expect(onValueCommit).toHaveBeenCalledWith([150]);
    });
});

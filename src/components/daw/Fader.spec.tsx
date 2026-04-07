import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Fader } from './Fader';

describe('Fader', () => {
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
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MechanicalSwitch } from './MechanicalSwitch';

describe('MechanicalSwitch', () => {
    it('should toggle via switch role', () => {
        const onChange = vi.fn();
        render(<MechanicalSwitch checked={false} onChange={onChange} label="Power" />);
        const sw = screen.getByRole('switch');
        expect(sw).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(true);
        expect(screen.getByText('Power')).toBeInTheDocument();
    });

    it('should render checked state and toggle off', () => {
        const onChange = vi.fn();
        render(<MechanicalSwitch checked={true} onChange={onChange} label="On" />);
        const sw = screen.getByRole('switch');
        expect(sw).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(sw);
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it('should render without label', () => {
        const { container } = render(<MechanicalSwitch checked={false} onChange={vi.fn()} />);
        expect(container.querySelector('span')).toBeNull();
    });

    it('should apply size variants', () => {
        const { rerender, container } = render(
            <MechanicalSwitch checked={false} onChange={vi.fn()} size="sm" />
        );
        expect(screen.getByRole('switch')).toHaveClass('w-4');
        rerender(<MechanicalSwitch checked={false} onChange={vi.fn()} size="md" />);
        expect(screen.getByRole('switch')).toHaveClass('w-6');
        rerender(<MechanicalSwitch checked={false} onChange={vi.fn()} size="lg" />);
        expect(screen.getByRole('switch')).toHaveClass('w-8');
        expect(container.firstChild).toHaveClass('flex');
    });
});

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
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../input';

describe('Input', () => {
    it('should render with data-slot and forward value changes', () => {
        const onChange = vi.fn();
        render(<Input aria-label="Test input" onChange={onChange} />);
        const input = screen.getByRole('textbox', { name: 'Test input' });
        expect(input).toHaveAttribute('data-slot', 'input');
        fireEvent.change(input, { target: { value: 'hello' } });
        expect(onChange).toHaveBeenCalled();
    });

    it('should pass type through to the native input', () => {
        render(<Input type="number" aria-label="Num" />);
        expect(screen.getByRole('spinbutton', { name: 'Num' })).toHaveAttribute('type', 'number');
    });
});

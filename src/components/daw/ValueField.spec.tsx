import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValueField } from './ValueField';

describe('ValueField', () => {
    it('should display rounded value and unit', () => {
        render(<ValueField value={3.456} onChange={vi.fn()} unit="%" />);
        expect(screen.getByText('3.46%')).toBeInTheDocument();
    });

    it('should call onReset on double click', () => {
        const onReset = vi.fn();
        render(<ValueField value={5} onChange={vi.fn()} onReset={onReset} />);
        fireEvent.doubleClick(screen.getByText('5'));
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('should call onChange during pointer drag after pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} step={1} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 1, clientY: 100, shiftKey: false });
        fireEvent.pointerMove(field, { pointerId: 1, clientY: 80, shiftKey: false });
        expect(onChange).toHaveBeenCalled();
    });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ValueField } from '../ValueField';

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

    it('should use fine step when shift is held during drag', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} step={1} fineStep={0.1} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 2, clientY: 90, shiftKey: true });
        expect(onChange).toHaveBeenCalled();
    });

    it('should ignore pointer move before pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} />);
        const field = screen.getByText('0');
        fireEvent.pointerMove(field, { pointerId: 9, clientY: 50 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should ignore non-left pointer down', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 1, pointerId: 3 });
        fireEvent.pointerMove(field, { pointerId: 3, clientY: 10 });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should render label when provided', () => {
        render(<ValueField value={1} onChange={vi.fn()} label="Amount" />);
        expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    it('should not call onReset when double click without onReset', () => {
        const onChange = vi.fn();
        render(<ValueField value={5} onChange={onChange} />);
        fireEvent.doubleClick(screen.getByText('5'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should end drag on pointer up', () => {
        const onChange = vi.fn();
        render(<ValueField value={0} onChange={onChange} min={-10} max={10} />);
        const field = screen.getByText('0');
        fireEvent.pointerDown(field, { button: 0, pointerId: 4, clientY: 100 });
        fireEvent.pointerMove(field, { pointerId: 4, clientY: 90 });
        fireEvent.pointerUp(field, { pointerId: 4 });
        onChange.mockClear();
        fireEvent.pointerMove(field, { pointerId: 4, clientY: 80 });
        expect(onChange).not.toHaveBeenCalled();
    });
});

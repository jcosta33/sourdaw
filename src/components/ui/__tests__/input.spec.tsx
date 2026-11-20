import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
    it.each(['text', 'number'])('preserves composition and forwards other keys for %s inputs', (type) => {
        const parentKeyDown = vi.fn();
        const onKeyDown = vi.fn();
        render(
            <div onKeyDown={parentKeyDown}>
                <Input type={type} aria-label="Editor" onKeyDown={onKeyDown} />
            </div>
        );
        const input = screen.getByLabelText('Editor');
        const composingEnter = createEvent.keyDown(input, {
            key: 'Enter',
            isComposing: true,
            bubbles: true,
            cancelable: true,
        });
        fireEvent(input, composingEnter);
        expect(onKeyDown).not.toHaveBeenCalled();
        expect(parentKeyDown).not.toHaveBeenCalled();
        expect(composingEnter.defaultPrevented).toBe(false);
        fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
        fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
        expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(['Enter', 'ArrowDown']);
        expect(parentKeyDown.mock.calls.map(([event]) => event.key)).toEqual(['Enter', 'ArrowDown']);
    });
    it('forwards composition events and leaves keys alone when no key handler is supplied', () => {
        const onCompositionStart = vi.fn();
        const onCompositionEnd = vi.fn();
        const parentKeyDown = vi.fn();
        render(
            <div onKeyDown={parentKeyDown}>
                <Input
                    aria-label="Editor"
                    onCompositionStart={onCompositionStart}
                    onCompositionEnd={onCompositionEnd}
                />
            </div>
        );
        const input = screen.getByLabelText('Editor');
        fireEvent.compositionStart(input);
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
        fireEvent.compositionEnd(input);
        expect(onCompositionStart).toHaveBeenCalledOnce();
        expect(onCompositionEnd).toHaveBeenCalledOnce();
        expect(parentKeyDown).toHaveBeenCalledOnce();
    });
});

import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawMenuInlineEditor } from '../DawMenuInlineEditor';

describe('DawMenuInlineEditor', () => {
    it('should submit on Enter and cancel on Escape', () => {
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        const onChange = vi.fn();
        render(
            <DawMenuInlineEditor label="Name" value="a" onChange={onChange} onSubmit={onSubmit} onCancel={onCancel} />
        );
        const input = screen.getByRole('textbox');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalled();
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
    });

    it('should call onSubmit, preventDefault, and stopPropagation on Enter', () => {
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        const onChange = vi.fn();
        render(
            <DawMenuInlineEditor label="Name" value="a" onChange={onChange} onSubmit={onSubmit} onCancel={onCancel} />
        );
        const input = screen.getByRole('textbox');
        const enterEvent = createEvent.keyDown(input, { key: 'Enter', cancelable: true });
        const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');
        const stopPropagationSpy = vi.spyOn(enterEvent, 'stopPropagation');
        fireEvent(input, enterEvent);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(enterEvent.defaultPrevented).toBe(true);
    });

    it('should call onCancel, preventDefault, and stopPropagation on Escape', () => {
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        const onChange = vi.fn();
        render(
            <DawMenuInlineEditor label="Name" value="a" onChange={onChange} onSubmit={onSubmit} onCancel={onCancel} />
        );
        const input = screen.getByRole('textbox');
        const escapeEvent = createEvent.keyDown(input, { key: 'Escape', cancelable: true });
        const preventDefaultSpy = vi.spyOn(escapeEvent, 'preventDefault');
        const stopPropagationSpy = vi.spyOn(escapeEvent, 'stopPropagation');
        fireEvent(input, escapeEvent);

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(escapeEvent.defaultPrevented).toBe(true);
    });
});

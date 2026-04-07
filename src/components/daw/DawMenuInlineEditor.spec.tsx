import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawMenuInlineEditor } from './DawMenuInlineEditor';

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
});

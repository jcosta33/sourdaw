import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle', () => {
    it('should call onResize when mouse moves after drag', () => {
        const onResize = vi.fn();
        const { container } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 100, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: 110, clientY: 0 });
        expect(onResize).toHaveBeenCalled();
    });
});

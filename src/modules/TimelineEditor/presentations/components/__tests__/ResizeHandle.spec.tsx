import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    it('keeps document listeners stable while using the latest resize callback', () => {
        const firstOnResize = vi.fn();
        const secondOnResize = vi.fn();
        const firstOnResizeEnd = vi.fn();
        const secondOnResizeEnd = vi.fn();
        const addEventListener = vi.spyOn(document, 'addEventListener');
        const { rerender } = render(
            <ResizeHandle direction="vertical" onResize={firstOnResize} onResizeEnd={firstOnResizeEnd} />
        );
        const listenerCountAfterMount = addEventListener.mock.calls.length;

        rerender(<ResizeHandle direction="vertical" onResize={secondOnResize} onResizeEnd={secondOnResizeEnd} />);
        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 10 });
        fireEvent.mouseMove(document, { clientX: 16 });
        fireEvent.mouseUp(document);

        expect(addEventListener).toHaveBeenCalledTimes(listenerCountAfterMount);
        expect(firstOnResize).not.toHaveBeenCalled();
        expect(secondOnResize).toHaveBeenCalledWith(6);
        expect(firstOnResizeEnd).not.toHaveBeenCalled();
        expect(secondOnResizeEnd).toHaveBeenCalledTimes(1);
    });
});

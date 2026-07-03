import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawContextMenuSurface } from '../DawContextMenuSurface';

describe('DawContextMenuSurface', () => {
    it('should render children without portal', () => {
        const { container } = render(
            <DawContextMenuSurface x={10} y={20} portal={false}>
                <span>Item</span>
            </DawContextMenuSurface>
        );
        const item = screen.getByText('Item');

        expect(item).toBeInTheDocument();
        expect(container).toContainElement(item);
    });

    it('should render children through a portal by default', () => {
        const { container } = render(
            <DawContextMenuSurface x={10} y={20}>
                <span>Portal item</span>
            </DawContextMenuSurface>
        );
        const portal_item = screen.getByText('Portal item');

        expect(portal_item).toBeInTheDocument();
        expect(container).not.toContainElement(portal_item);
        expect(document.body).toContainElement(portal_item);
    });

    it('should call onClose when the backdrop button is clicked', () => {
        const handle_close = vi.fn();

        render(
            <DawContextMenuSurface backdrop onClose={handle_close} x={10} y={20}>
                <span>Menu item</span>
            </DawContextMenuSurface>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Close context menu' }));

        expect(handle_close).toHaveBeenCalledOnce();
    });
});

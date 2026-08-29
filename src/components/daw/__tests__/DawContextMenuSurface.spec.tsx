import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DawContextMenuSurface } from '../DawContextMenuSurface';

describe('DawContextMenuSurface', () => {
    afterEach(() => vi.unstubAllGlobals());

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

    it('keeps a tall context menu scrollable inside the remaining viewport height', () => {
        render(
            <DawContextMenuSurface x={10} y={20} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.maxHeight).toBe('calc(100vh - 28px)');
        expect(menu.style.overflowY).toBe('auto');
    });

    it.each([
        {
            name: 'below a near-top pointer',
            y: 20,
            top: '20px',
            bottom: '',
            maxHeight: 'calc(100vh - 28px)',
        },
        {
            name: 'above a mid-viewport pointer',
            y: 200,
            top: '',
            bottom: '160px',
            maxHeight: 'calc(100vh - 168px)',
        },
        {
            name: 'above a near-bottom pointer',
            y: 340,
            top: '',
            bottom: '20px',
            maxHeight: 'calc(100vh - 28px)',
        },
    ])('keeps an oversized default menu attached $name', ({ y, top, bottom, maxHeight }) => {
        vi.stubGlobal('innerHeight', 360);

        render(
            <DawContextMenuSurface x={10} y={y} yClampOffset={400} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.top).toBe(top);
        expect(menu.style.bottom).toBe(bottom);
        expect(menu.style.maxHeight).toBe(maxHeight);
        expect(menu.style.overflowY).toBe('auto');
    });

    it('keeps explicit up anchoring when the space below is larger', () => {
        vi.stubGlobal('innerHeight', 360);

        render(
            <DawContextMenuSurface x={10} y={20} anchorY="up" yClampOffset={400} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.top).toBe('');
        expect(menu.style.bottom).toBe('340px');
        expect(menu.style.maxHeight).toBe('calc(100vh - 348px)');
        expect(menu.style.overflowY).toBe('auto');
    });

    it('uses available space for auto anchoring when the estimated height cannot fit', () => {
        vi.stubGlobal('innerHeight', 360);

        render(
            <DawContextMenuSurface x={10} y={200} anchorY="auto" yClampOffset={400} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.top).toBe('');
        expect(menu.style.bottom).toBe('160px');
        expect(menu.style.maxHeight).toBe('calc(100vh - 168px)');
    });
});

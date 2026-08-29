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

    it('clamps a down-anchored menu opened near the lower viewport edge', () => {
        vi.stubGlobal('innerHeight', 360);

        render(
            <DawContextMenuSurface x={10} y={340} yClampOffset={300} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.top).toBe('60px');
        expect(menu.style.bottom).toBe('');
        expect(menu.style.maxHeight).toBe('calc(100vh - 68px)');
        expect(menu.style.overflowY).toBe('auto');
    });

    it.each(['up', 'auto'] as const)('keeps a %s-anchored menu scrollable above its anchor', (anchorY) => {
        vi.stubGlobal('innerHeight', 360);

        render(
            <DawContextMenuSurface x={10} y={340} anchorY={anchorY} portal={false} role="menu">
                <span>Item</span>
            </DawContextMenuSurface>
        );

        const menu = screen.getByRole('menu');
        expect(menu.style.top).toBe('');
        expect(menu.style.bottom).toBe('20px');
        expect(menu.style.maxHeight).toBe('calc(100vh - 28px)');
        expect(menu.style.overflowY).toBe('auto');
    });
});

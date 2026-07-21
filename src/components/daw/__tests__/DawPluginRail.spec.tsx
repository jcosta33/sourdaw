import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawPluginRail } from '../DawPluginRail';

describe('DawPluginRail', () => {
    it('renders a scrollable aside contract by default and preserves child order', () => {
        render(
            <DawPluginRail data-testid="plugin-rail">
                <span>first</span>
                <span>second</span>
            </DawPluginRail>
        );

        const rail = screen.getByTestId('plugin-rail');

        expect(rail.tagName).toBe('ASIDE');
        expect(rail).toHaveClass('flex', 'min-h-0', 'flex-col', 'gap-3', 'overflow-y-auto', 'pr-1');
        expect(Array.from(rail.children, (child) => child.textContent)).toEqual(['first', 'second']);
    });

    it('renders as a non-scrolling div when requested', () => {
        render(
            <DawPluginRail data-testid="plugin-rail" as="div" scrollable={false}>
                rail
            </DawPluginRail>
        );

        const rail = screen.getByTestId('plugin-rail');

        expect(rail.tagName).toBe('DIV');
        expect(rail).toHaveClass('flex', 'min-h-0', 'flex-col', 'gap-3');
        expect(rail).not.toHaveClass('overflow-y-auto', 'pr-1');
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawPluginRail
                data-testid="plugin-rail"
                data-state="active"
                aria-label="Plugin controls"
                style={{ maxHeight: '480px' }}
                onClick={handleClick}
            >
                rail
            </DawPluginRail>
        );

        const rail = screen.getByRole('complementary', { name: 'Plugin controls' });

        expect(rail).toHaveAttribute('data-state', 'active');
        expect(rail).toHaveStyle({ maxHeight: '480px' });

        fireEvent.click(rail);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting rail and overflow hooks', () => {
        render(
            <DawPluginRail data-testid="plugin-rail" className="min-h-full flex-row gap-1 overflow-hidden pr-4">
                rail
            </DawPluginRail>
        );

        const rail = screen.getByTestId('plugin-rail');

        expect(rail).toHaveClass('min-h-full', 'flex-row', 'gap-1', 'overflow-hidden', 'pr-4');
        expect(rail).not.toHaveClass('min-h-0', 'flex-col', 'gap-3', 'overflow-y-auto', 'pr-1');
        expect(rail).toHaveClass('flex');
    });
});

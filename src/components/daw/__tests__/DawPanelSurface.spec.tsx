import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawPanelSurface } from '../DawPanelSurface';

describe('DawPanelSurface', () => {
    it('renders a base div and preserves child order by default', () => {
        render(
            <DawPanelSurface data-testid="panel-surface">
                <span>first</span>
                <span>second</span>
            </DawPanelSurface>
        );

        const panel = screen.getByTestId('panel-surface');

        expect(panel.tagName).toBe('DIV');
        expect(panel).toHaveClass('flex', 'h-full', 'flex-col', 'bg-surface-base');
        expect(Array.from(panel.children, (child) => child.textContent)).toEqual(['first', 'second']);
    });

    it.each([
        ['base', ['flex', 'h-full', 'flex-col', 'bg-surface-base']],
        [
            'dock',
            [
                'flex',
                'shrink-0',
                'flex-col',
                'border-t',
                'border-black/60',
                'bg-surface-base',
                'shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]',
            ],
        ],
        [
            'tray',
            [
                'contain-strict',
                'flex',
                'shrink-0',
                'flex-col',
                'border-l',
                'border-border-hairline',
                'bg-surface-tray',
                'shadow-[inset_1px_0_0_rgba(255,255,255,0.02),inset_0_1px_0_rgba(255,255,255,0.04)]',
            ],
        ],
    ] as const)('renders every %s tone hook', (tone, expectedClassNames) => {
        render(
            <DawPanelSurface data-testid="panel-surface" tone={tone}>
                panel
            </DawPanelSurface>
        );

        expect(screen.getByTestId('panel-surface')).toHaveClass(...expectedClassNames);
    });

    it('renders as an aside and forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawPanelSurface
                as="aside"
                data-testid="panel-surface"
                data-state="open"
                aria-label="Inspector"
                style={{ width: '320px' }}
                onClick={handleClick}
            >
                panel
            </DawPanelSurface>
        );

        const panel = screen.getByRole('complementary', { name: 'Inspector' });

        expect(panel.tagName).toBe('ASIDE');
        expect(panel).toHaveAttribute('data-state', 'open');
        expect(panel).toHaveStyle({ width: '320px' });

        fireEvent.click(panel);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting tone hooks', () => {
        render(
            <DawPanelSurface
                data-testid="panel-surface"
                tone="tray"
                className="flex-row shrink border-0 bg-black shadow-none"
            >
                panel
            </DawPanelSurface>
        );

        const panel = screen.getByTestId('panel-surface');

        expect(panel).toHaveClass('flex-row', 'shrink', 'border-0', 'bg-black', 'shadow-none');
        expect(panel).not.toHaveClass(
            'flex-col',
            'shrink-0',
            'border-l',
            'border-border-hairline',
            'bg-surface-tray',
            'shadow-[inset_1px_0_0_rgba(255,255,255,0.02),inset_0_1px_0_rgba(255,255,255,0.04)]'
        );
        expect(panel).toHaveClass('contain-strict', 'flex');
    });
});

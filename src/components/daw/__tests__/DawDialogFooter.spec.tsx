import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawDialogFooter } from '../DawDialogFooter';

describe('DawDialogFooter', () => {
    it('renders the neutral, between-aligned row contract by default', () => {
        render(
            <DawDialogFooter data-testid="dialog-footer">
                <span>cancel</span>
                <span>confirm</span>
            </DawDialogFooter>
        );

        const footer = screen.getByTestId('dialog-footer');

        expect(footer.tagName).toBe('DIV');
        expect(footer).toHaveClass(
            'flex',
            'flex-row',
            'min-w-0',
            'gap-2',
            'items-center',
            'justify-between',
            'border-t',
            'border-white/8',
            'bg-surface-base/45',
            'px-4',
            'py-3'
        );
        expect(Array.from(footer.children, (child) => child.textContent)).toEqual(['cancel', 'confirm']);
    });

    it.each([
        ['start', 'justify-start'],
        ['between', 'justify-between'],
        ['end', 'justify-end'],
    ] as const)('maps the %s alignment to %s', (align, expectedClassName) => {
        render(
            <DawDialogFooter data-testid="dialog-footer" align={align}>
                actions
            </DawDialogFooter>
        );

        expect(screen.getByTestId('dialog-footer')).toHaveClass(expectedClassName);
    });

    it('renders the warm tone contract', () => {
        render(
            <DawDialogFooter data-testid="dialog-footer" tone="warm">
                actions
            </DawDialogFooter>
        );

        expect(screen.getByTestId('dialog-footer')).toHaveClass(
            'border-orange-900/30',
            'bg-surface-base/55',
            'shadow-[inset_0_1px_0_rgba(251,146,60,0.06)]'
        );
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawDialogFooter
                data-testid="dialog-footer"
                data-state="ready"
                aria-label="Dialog actions"
                role="group"
                style={{ minHeight: '48px' }}
                onClick={handleClick}
            >
                actions
            </DawDialogFooter>
        );

        const footer = screen.getByRole('group', { name: 'Dialog actions' });

        expect(footer).toHaveAttribute('data-state', 'ready');
        expect(footer).toHaveStyle({ minHeight: '48px' });

        fireEvent.click(footer);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting tone, alignment, gap, and spacing classes', () => {
        render(
            <DawDialogFooter
                data-testid="dialog-footer"
                className="gap-4 justify-center border-blue-500 bg-black px-8 py-6"
            >
                actions
            </DawDialogFooter>
        );

        const footer = screen.getByTestId('dialog-footer');

        expect(footer).toHaveClass('gap-4', 'justify-center', 'border-blue-500', 'bg-black', 'px-8', 'py-6');
        expect(footer).not.toHaveClass(
            'gap-2',
            'justify-between',
            'border-white/8',
            'bg-surface-base/45',
            'px-4',
            'py-3'
        );
    });
});

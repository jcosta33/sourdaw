import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawPluginSectionCard } from '../DawPluginSectionCard';

describe('DawPluginSectionCard', () => {
    it('renders a semantic card with hidden detail and stable child order by default', () => {
        render(
            <DawPluginSectionCard data-testid="section-card" title="Filter" detail="Low pass">
                <span>first</span>
                <span>second</span>
            </DawPluginSectionCard>
        );

        const card = screen.getByTestId('section-card');
        const heading = card.children.item(0);
        const title = screen.getByText('Filter');
        const detail = screen.getByText('Low pass');

        expect(card.tagName).toBe('SECTION');
        expect(card).toHaveClass('flex', 'flex-col', 'gap-3', 'p-3');
        expect(heading).toHaveClass('flex', 'flex-col', 'gap-1');
        expect(title).toHaveClass('text-[8px]', 'font-semibold', 'uppercase', 'tracking-[0.24em]');
        expect(detail).toHaveClass('sr-only');
        expect(Array.from(card.children, (child) => child.textContent)).toEqual(['FilterLow pass', 'first', 'second']);
    });

    it('renders badge detail beside the title with both class hooks', () => {
        render(
            <DawPluginSectionCard
                data-testid="section-card"
                title="Filter"
                detail="LP"
                detailMode="badge"
                titleClassName="title-hook"
                detailClassName="detail-hook"
            >
                content
            </DawPluginSectionCard>
        );

        const card = screen.getByTestId('section-card');
        const heading = card.firstElementChild;
        const title = screen.getByText('Filter');
        const detail = screen.getByText('LP');

        expect(heading).toHaveClass('flex', 'items-center', 'justify-between', 'gap-2');
        expect(title).toHaveClass('title-hook');
        expect(detail).toHaveClass('detail-hook');
        expect(detail).not.toHaveClass('sr-only');
        expect(Array.from(heading?.children ?? [], (child) => child.textContent)).toEqual(['Filter', 'LP']);
    });

    it.each(['hidden', 'badge'] as const)('omits the optional detail in %s mode', (detailMode) => {
        render(
            <DawPluginSectionCard data-testid="section-card" title="Filter" detailMode={detailMode}>
                content
            </DawPluginSectionCard>
        );

        const heading = screen.getByTestId('section-card').firstElementChild;

        expect(heading?.children).toHaveLength(1);
        expect(heading).toHaveTextContent('Filter');
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawPluginSectionCard
                data-testid="section-card"
                data-state="active"
                aria-label="Filter controls"
                style={{ minWidth: '240px' }}
                onClick={handleClick}
                title="Filter"
            >
                content
            </DawPluginSectionCard>
        );

        const card = screen.getByRole('region', { name: 'Filter controls' });

        expect(card).toHaveAttribute('data-state', 'active');
        expect(card).toHaveStyle({ minWidth: '240px' });

        fireEvent.click(card);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override conflicting card and title hooks', () => {
        render(
            <DawPluginSectionCard
                data-testid="section-card"
                className="flex-row gap-1 p-1"
                title="Filter"
                titleClassName="text-sm font-normal normal-case tracking-normal"
            >
                content
            </DawPluginSectionCard>
        );

        const card = screen.getByTestId('section-card');
        const title = screen.getByText('Filter');

        expect(card).toHaveClass('flex-row', 'gap-1', 'p-1');
        expect(card).not.toHaveClass('flex-col', 'gap-3', 'p-3');
        expect(title).toHaveClass('text-sm', 'font-normal', 'normal-case', 'tracking-normal');
        expect(title).not.toHaveClass('text-[8px]', 'font-semibold', 'uppercase', 'tracking-[0.24em]');
    });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawDialogSection } from '../DawDialogSection';

describe('DawDialogSection', () => {
    it('renders a neutral semantic section with no header when header content is absent', () => {
        render(
            <DawDialogSection data-testid="dialog-section" bodyClassName="body-hook">
                <span>content</span>
            </DawDialogSection>
        );

        const section = screen.getByTestId('dialog-section');
        const body = section.firstElementChild;

        expect(section.tagName).toBe('SECTION');
        expect(section).toHaveClass('overflow-hidden', 'rounded-lg', 'border', 'border-white/8', 'bg-white/[0.03]');
        expect(section.children).toHaveLength(1);
        expect(section.querySelector('.border-b')).not.toBeInTheDocument();
        expect(body).toHaveClass('body-hook', 'px-3', 'py-3');
        expect(body).toHaveTextContent('content');
    });

    it('preserves header, title, detail, actions, then body order', () => {
        render(
            <DawDialogSection
                data-testid="dialog-section"
                title="Export"
                detail={<span>WAV</span>}
                actions={<button type="button">Choose</button>}
                bodyClassName="body-hook"
            >
                <span>Content</span>
            </DawDialogSection>
        );

        const section = screen.getByTestId('dialog-section');
        const header = section.children.item(0);
        const body = section.children.item(1);
        const headerContent = header?.children.item(0);
        const actions = header?.children.item(1);

        expect(section.children).toHaveLength(2);
        expect(header).toHaveClass('flex', 'items-center', 'justify-between', 'gap-3', 'border-b', 'border-white/6');
        expect(Array.from(headerContent?.children ?? [], (child) => child.textContent)).toEqual(['Export', 'WAV']);
        expect(actions).toHaveClass('shrink-0');
        expect(actions).toHaveTextContent('Choose');
        expect(body).toHaveClass('body-hook', 'px-3', 'py-3');
        expect(body).toHaveTextContent('Content');
    });

    it('renders every warm tone hook on the section, header, and title', () => {
        render(
            <DawDialogSection data-testid="dialog-section" tone="warm" title="Danger zone">
                Content
            </DawDialogSection>
        );

        const section = screen.getByTestId('dialog-section');
        const header = section.firstElementChild;
        const title = screen.getByText('Danger zone');

        expect(section).toHaveClass(
            'border-orange-900/30',
            'bg-surface-base/50',
            'shadow-[inset_0_1px_0_rgba(251,146,60,0.05)]'
        );
        expect(header).toHaveClass('border-orange-900/25');
        expect(title).toHaveClass('text-orange-300/85');
    });

    it('renders a stable header shape for each individual optional header slot', () => {
        const { rerender } = render(
            <DawDialogSection data-testid="dialog-section" title="Title">
                Content
            </DawDialogSection>
        );

        expect(screen.getByTestId('dialog-section').children).toHaveLength(2);
        expect(screen.getByText('Title')).toBeInTheDocument();

        rerender(
            <DawDialogSection data-testid="dialog-section" detail="Detail">
                Content
            </DawDialogSection>
        );

        expect(screen.getByTestId('dialog-section').children).toHaveLength(2);
        expect(screen.getByText('Detail')).toBeInTheDocument();

        rerender(
            <DawDialogSection data-testid="dialog-section" actions={<button type="button">Action</button>}>
                Content
            </DawDialogSection>
        );

        expect(screen.getByTestId('dialog-section').children).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });

    it('forwards native props, events, and styles', () => {
        const handleClick = vi.fn();

        render(
            <DawDialogSection
                data-testid="dialog-section"
                data-state="ready"
                aria-label="Export settings"
                style={{ minHeight: '160px' }}
                onClick={handleClick}
            >
                Content
            </DawDialogSection>
        );

        const section = screen.getByRole('region', { name: 'Export settings' });

        expect(section).toHaveAttribute('data-state', 'ready');
        expect(section).toHaveStyle({ minHeight: '160px' });

        fireEvent.click(section);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override section and body presentation hooks', () => {
        render(
            <DawDialogSection
                data-testid="dialog-section"
                className="overflow-visible rounded-none border-0 bg-black"
                bodyClassName="body-hook px-6 py-5"
            >
                Content
            </DawDialogSection>
        );

        const section = screen.getByTestId('dialog-section');
        const body = section.firstElementChild;

        expect(section).toHaveClass('overflow-visible', 'rounded-none', 'border-0', 'bg-black');
        expect(section).not.toHaveClass('overflow-hidden', 'rounded-lg', 'border', 'bg-white/[0.03]');
        expect(body).toHaveClass('body-hook', 'px-6', 'py-5');
        expect(body).not.toHaveClass('px-3', 'py-3');
    });
});

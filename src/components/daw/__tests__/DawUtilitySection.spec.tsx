import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawUtilitySection } from '../DawUtilitySection';

describe('DawUtilitySection', () => {
    it('renders a semantic section with stable title, header, then body order', () => {
        render(
            <DawUtilitySection data-testid="utility-section" title="Inputs" bodyClassName="body-hook">
                <span>body</span>
            </DawUtilitySection>
        );

        const section = screen.getByTestId('utility-section');
        const header = section.children.item(0);
        const headerContent = header?.children.item(0);
        const body = section.children.item(1);

        expect(section.tagName).toBe('SECTION');
        expect(section).toHaveClass('rounded-md', 'border', 'border-white/8', 'bg-white/[0.03]');
        expect(section.children).toHaveLength(2);
        expect(header).toHaveClass(
            'flex',
            'items-center',
            'justify-between',
            'gap-2',
            'border-b',
            'border-white/6',
            'px-2.5',
            'py-2'
        );
        expect(headerContent?.children).toHaveLength(1);
        expect(headerContent).toHaveTextContent('Inputs');
        expect(body).toHaveClass('body-hook', 'px-2.5', 'py-2');
        expect(body).toHaveTextContent('body');
    });

    it('preserves title, detail, actions, then body order when optional slots are present', () => {
        render(
            <DawUtilitySection
                data-testid="utility-section"
                title={<span>Inputs</span>}
                detail={<span>2 active</span>}
                actions={<button type="button">Add</button>}
            >
                <span>body</span>
            </DawUtilitySection>
        );

        const section = screen.getByTestId('utility-section');
        const header = section.children.item(0);
        const headerContent = header?.children.item(0);
        const actions = header?.children.item(1);
        const body = section.children.item(1);

        expect(Array.from(headerContent?.children ?? [], (child) => child.textContent)).toEqual(['Inputs', '2 active']);
        expect(actions).toHaveClass('shrink-0');
        expect(actions).toHaveTextContent('Add');
        expect(body).toHaveTextContent('body');
    });

    it('keeps a stable header when only actions are supplied', () => {
        render(
            <DawUtilitySection title="Inputs" actions={<button type="button">Add</button>}>
                body
            </DawUtilitySection>
        );

        expect(screen.queryByText('2 active')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
        expect(screen.getByText('Inputs')).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
    });

    it('forwards native props, events, styles, and refs', () => {
        const ref = createRef<HTMLElement>();
        const handleClick = vi.fn();

        render(
            <DawUtilitySection
                ref={ref}
                data-testid="utility-section"
                data-state="ready"
                aria-label="Input analysis"
                style={{ minHeight: '180px' }}
                onClick={handleClick}
                title="Inputs"
            >
                body
            </DawUtilitySection>
        );

        const section = screen.getByRole('region', { name: 'Input analysis' });

        expect(ref.current).toBe(section);
        expect(section).toHaveAttribute('data-state', 'ready');
        expect(section).toHaveStyle({ minHeight: '180px' });

        fireEvent.click(section);
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('lets caller classes override section and body presentation hooks', () => {
        render(
            <DawUtilitySection
                data-testid="utility-section"
                title="Inputs"
                className="rounded-none border-0 bg-black shadow-none"
                bodyClassName="body-hook px-6 py-5"
            >
                body
            </DawUtilitySection>
        );

        const section = screen.getByTestId('utility-section');
        const body = section.children.item(1);

        expect(section).toHaveClass('rounded-none', 'border-0', 'bg-black', 'shadow-none');
        expect(section).not.toHaveClass(
            'rounded-md',
            'border',
            'border-white/8',
            'bg-white/[0.03]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_-1px_0_rgba(0,0,0,0.22)]'
        );
        expect(body).toHaveClass('body-hook', 'px-6', 'py-5');
        expect(body).not.toHaveClass('px-2.5', 'py-2');
    });
});

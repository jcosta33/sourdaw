import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawEmptyState } from '../DawEmptyState';

describe('DawEmptyState', () => {
    it('should render title and optional description', () => {
        render(<DawEmptyState title="Nothing here" description="Add items" />);
        expect(screen.getByText('Nothing here')).toBeInTheDocument();
        expect(screen.getByText('Add items')).toBeInTheDocument();
    });

    it('should omit description when not provided', () => {
        render(<DawEmptyState title="Only title" />);
        expect(screen.getByText('Only title')).toBeInTheDocument();
        expect(screen.getAllByRole('paragraph')).toHaveLength(1);
    });

    it('should render icon and action slots', () => {
        render(
            <DawEmptyState
                title="T"
                icon={<span data-testid="ico">icon</span>}
                action={<button type="button">Go</button>}
            />
        );
        expect(screen.getByTestId('ico')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });

    it('should wrap icon in muted foreground container', () => {
        render(<DawEmptyState title="T" icon={<span data-testid="ico">i</span>} />);
        expect(screen.getByTestId('ico').parentElement).toHaveClass('text-muted-foreground/55');
    });

    it('should not render an icon row when icon is omitted', () => {
        const { container } = render(<DawEmptyState title="T" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root.querySelectorAll(':scope > div')).toHaveLength(1);
    });

    it('should apply default surface spacing and title size when not compact', () => {
        const { container } = render(<DawEmptyState title="Title" description="Desc" />);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('gap-2', 'p-5');
        expect(screen.getByText('Title')).toHaveClass('text-sm');
        expect(screen.getByText('Desc')).toHaveClass('text-xs');
    });

    it('should apply compact spacing and typography when compact is true', () => {
        const { container } = render(<DawEmptyState title="Title" description="Desc" compact />);
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('gap-1.5', 'p-4');
        expect(screen.getByText('Title')).toHaveClass('text-xs');
        expect(screen.getByText('Desc')).toHaveClass('text-[10px]');
    });

    it('should merge custom className onto the root', () => {
        const { container } = render(<DawEmptyState title="T" className="extra-root" />);
        expect(container.firstElementChild).toHaveClass('extra-root', 'daw-empty-state-surface');
    });
});

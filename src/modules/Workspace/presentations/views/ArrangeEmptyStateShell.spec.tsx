import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArrangeEmptyStateShell } from './ArrangeEmptyStateShell';

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(' '),
}));

describe('ArrangeEmptyStateShell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(
            <ArrangeEmptyStateShell>
                <span>Test Content</span>
            </ArrangeEmptyStateShell>
        );
        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should render children correctly', () => {
        render(
            <ArrangeEmptyStateShell>
                <div data-testid="child">Child Element</div>
            </ArrangeEmptyStateShell>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should apply active styling when active prop is true', () => {
        const { container } = render(
            <ArrangeEmptyStateShell active>
                <span>Active Content</span>
            </ArrangeEmptyStateShell>
        );
        expect(container.firstChild).toHaveClass('border-2');
        expect(container.firstChild).toHaveClass('border-[var(--color-accent-orange)]');
    });

    it('should not apply active styling when active prop is false', () => {
        const { container } = render(
            <ArrangeEmptyStateShell active={false}>
                <span>Inactive Content</span>
            </ArrangeEmptyStateShell>
        );
        expect(container.firstChild).not.toHaveClass('border-2');
    });

    it('should apply custom className', () => {
        const { container } = render(
            <ArrangeEmptyStateShell className="custom-class">
                <span>Content</span>
            </ArrangeEmptyStateShell>
        );
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should pass through additional props', () => {
        render(
            <ArrangeEmptyStateShell data-testid="shell" aria-label="Empty state">
                <span>Content</span>
            </ArrangeEmptyStateShell>
        );
        const shell = screen.getByTestId('shell');
        expect(shell).toBeInTheDocument();
        expect(shell).toHaveAttribute('aria-label', 'Empty state');
    });

    it('should have correct default active prop', () => {
        const { container } = render(
            <ArrangeEmptyStateShell>
                <span>Content</span>
            </ArrangeEmptyStateShell>
        );
        expect(container.firstChild).not.toHaveClass('border-2');
    });
});

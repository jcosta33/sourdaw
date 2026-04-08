import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutomationSidebarCell } from './AutomationSidebarCell';

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(' '),
}));

describe('AutomationSidebarCell', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(
            <AutomationSidebarCell>
                <span>Test Content</span>
            </AutomationSidebarCell>
        );
        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should render children correctly', () => {
        render(
            <AutomationSidebarCell>
                <div data-testid="child">Child Element</div>
            </AutomationSidebarCell>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should apply default styling classes', () => {
        const { container } = render(
            <AutomationSidebarCell>
                <span>Content</span>
            </AutomationSidebarCell>
        );
        expect(container.firstChild).toHaveClass('min-w-0');
        expect(container.firstChild).toHaveClass('border-r');
        expect(container.firstChild).toHaveClass('border-border/30');
        expect(container.firstChild).toHaveClass('bg-surface-well');
    });

    it('should apply custom className', () => {
        const { container } = render(
            <AutomationSidebarCell className="custom-class">
                <span>Content</span>
            </AutomationSidebarCell>
        );
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should pass through additional props', () => {
        render(
            <AutomationSidebarCell data-testid="cell" aria-label="Sidebar cell">
                <span>Content</span>
            </AutomationSidebarCell>
        );
        const cell = screen.getByTestId('cell');
        expect(cell).toBeInTheDocument();
        expect(cell).toHaveAttribute('aria-label', 'Sidebar cell');
    });
});

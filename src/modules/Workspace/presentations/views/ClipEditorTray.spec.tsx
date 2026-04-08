import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipEditorTray } from './ClipEditorTray';

vi.mock('#/helpers/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(' '),
}));

describe('ClipEditorTray', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(
            <ClipEditorTray>
                <span>Test Content</span>
            </ClipEditorTray>
        );
        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should render children correctly', () => {
        render(
            <ClipEditorTray>
                <div data-testid="child">Child Element</div>
            </ClipEditorTray>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should apply default styling classes', () => {
        const { container } = render(
            <ClipEditorTray>
                <span>Content</span>
            </ClipEditorTray>
        );
        expect(container.firstChild).toHaveClass('border-t');
        expect(container.firstChild).toHaveClass('border-border/30');
        expect(container.firstChild).toHaveClass('bg-surface-base/40');
    });

    it('should apply custom className', () => {
        const { container } = render(
            <ClipEditorTray className="custom-class">
                <span>Content</span>
            </ClipEditorTray>
        );
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should pass through additional props', () => {
        render(
            <ClipEditorTray data-testid="tray" aria-label="Clip editor tray">
                <span>Content</span>
            </ClipEditorTray>
        );
        const tray = screen.getByTestId('tray');
        expect(tray).toBeInTheDocument();
        expect(tray).toHaveAttribute('aria-label', 'Clip editor tray');
    });
});

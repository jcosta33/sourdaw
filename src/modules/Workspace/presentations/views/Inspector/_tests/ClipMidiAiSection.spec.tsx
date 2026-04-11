import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ClipMidiAiSection } from '../ClipMidiAiSection';

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, startSlot, compact, className }: { title: string; startSlot?: React.ReactNode; compact?: boolean; className?: string }) => (
        <div className={className} data-compact={compact}>
            {startSlot}
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
        <button type="button" onClick={onClick} disabled={disabled} className={className}>
            {children}
        </button>
    ),
}));

vi.mock('#/modules/AiGeneration/useCases/generateMidiVariations', () => ({
    generateMidiVariations: vi.fn(),
}));

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/useCases/notifyAiChange', () => ({
    notifyAiChange: vi.fn(),
}));

describe('ClipMidiAiSection', () => {
    const defaultProps = {
        clipId: 'clip-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText('AI Actions')).toBeInTheDocument();
    });

    it('should display section title', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText('AI Variations')).toBeInTheDocument();
    });

    it('should display description text', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByText(/Generate 3 musical variations/)).toBeInTheDocument();
    });

    it('should show generate button', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        expect(screen.getByRole('button', { name: /Generate/ })).toBeInTheDocument();
    });

    it('should show correct initial button text', () => {
        render(<ClipMidiAiSection {...defaultProps} />);
        const button = screen.getByRole('button', { name: /Generate/ });
        expect(button).not.toBeDisabled();
        expect(button.textContent).toContain('Generate');
    });
});

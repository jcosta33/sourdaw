import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { ClipGainEnvelopeSection } from '../ClipGainEnvelopeSection';

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        startSlot,
        compact,
        className,
    }: {
        title: string;
        startSlot?: React.ReactNode;
        compact?: boolean;
        className?: string;
    }) => (
        <div className={className} data-compact={compact}>
            {startSlot}
            <span>{title}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({
        children,
        rounded,
        className,
    }: {
        children: React.ReactNode;
        rounded?: string;
        className?: string;
    }) => (
        <span className={className} data-rounded={rounded}>
            {children}
        </span>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
        className,
        'aria-label': ariaLabel,
        title,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
        className?: string;
        'aria-label'?: string;
        title?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            className={className}
            data-variant={variant}
            data-size={size}
            aria-label={ariaLabel}
            title={title}
        >
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/InsetPanel', () => ({
    InsetPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('#/modules/Arrangement/useCases/clipGainEnvelope/getClipGainEnvelope', () => ({
    getClipGainEnvelope: vi.fn(() => ({ enabled: false, points: [] })),
}));

vi.mock('#/modules/Arrangement/useCases/clipGainEnvelope/toggleClipGainEnvelope', () => ({
    toggleClipGainEnvelope: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipGainEnvelope/addGainEnvelopePoint', () => ({
    addGainEnvelopePoint: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipGainEnvelope/removeGainEnvelopePoint', () => ({
    removeGainEnvelopePoint: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/clipGainEnvelope/resetClipGainEnvelope', () => ({
    resetClipGainEnvelope: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('ClipGainEnvelopeSection', () => {
    const defaultProps = {
        clipId: 'clip-1',
        duration: 8,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByText('Gain Envelope')).toBeInTheDocument();
    });

    it('should display section title', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByText('Gain Envelope')).toBeInTheDocument();
    });

    it('should render toggle button', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByLabelText('Enable gain envelope')).toBeInTheDocument();
    });

    it('should render add breakpoint button', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByLabelText('Add breakpoint')).toBeInTheDocument();
    });

    it('should render reset button', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByLabelText('Reset gain envelope')).toBeInTheDocument();
    });

    it('should display envelope status', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        expect(screen.getByText(/Disabled/)).toBeInTheDocument();
        expect(screen.getByText(/0 points/)).toBeInTheDocument();
    });
});

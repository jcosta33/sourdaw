import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { getClipGainEnvelope } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';

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

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getClipGainEnvelope: vi.fn(() => ({ enabled: false, points: [] })),
    };
});

// Toggle, add, remove and reset dispatch through the command path (#4617); the
// assertions below pin the dispatched actions, not the bare use cases. The
// action-routed graph pulls more of the barrel in than the view itself calls,
// so the mock has to supply every name the graph imports.
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    getExecutableAppActionEffect: vi.fn(() => null),
    executeAppAction: vi.fn().mockResolvedValue(undefined),
    executeAppActionBatch: vi.fn().mockResolvedValue([]),
    pushUndoEntry: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
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

    it('dispatches a guarded toggle with the pre-toggle enabled value', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Enable gain envelope'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'toggleClipGainEnvelope',
            payload: { clipId: 'clip-1', expectedEnabled: false },
        });
    });

    it('dispatches an add breakpoint at the midpoint', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Add breakpoint'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'addGainEnvelopePoint',
            payload: { clipId: 'clip-1', beatOffset: 4, gainDb: 0 },
        });
    });

    it('dispatches a reset', () => {
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Reset gain envelope'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'resetClipGainEnvelope',
            payload: { clipId: 'clip-1' },
        });
    });

    it('dispatches a point removal from its row button', () => {
        vi.mocked(getClipGainEnvelope).mockReturnValue({
            clipId: 'clip-1',
            enabled: true,
            points: [{ id: 'gep-1', beatOffset: 2, gainDb: -6 }],
        });
        renderWithTooltip(<ClipGainEnvelopeSection {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Remove breakpoint at beat 2'));
        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'removeGainEnvelopePoint',
            payload: { clipId: 'clip-1', pointId: 'gep-1' },
        });
    });
});

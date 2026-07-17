import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackClipsSection } from '../TrackClipsSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockAcceptGhostClip = vi.fn();
const mockDismissGhostClip = vi.fn();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        acceptGhostClip: (...args: unknown[]) => mockAcceptGhostClip(...args),
        dismissGhostClip: (...args: unknown[]) => mockDismissGhostClip(...args),
    };
});

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({ children }: { children: React.ReactNode }) => <span data-testid="micro-badge">{children}</span>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
    }: {
        children: React.ReactNode;
        onClick?: (e: React.MouseEvent) => void;
        variant?: string;
    }) => (
        <button data-testid="button" data-variant={variant} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/ChoiceCard', () => ({
    ChoiceCard: ({
        children,
        onClick,
        className,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        className?: string;
    }) => (
        <div data-testid="choice-card" className={className} onClick={onClick}>
            {children}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/MetaText', () => ({
    MetaText: ({ children }: { children: React.ReactNode }) => <span data-testid="meta-text">{children}</span>,
}));

describe('TrackClipsSection', () => {
    const mockOnSelectClip = vi.fn();

    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [
            {
                id: 'clip-1',
                trackId: 'track-1',
                name: 'Clip 1',
                startBeat: 0,
                endBeat: 16,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ff0000',
                locked: false,
                muted: false,
            },
            {
                id: 'clip-2',
                trackId: 'track-1',
                name: 'Clip 2',
                startBeat: 16,
                endBeat: 32,
                type: 'audio',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ff0000',
                locked: false,
                muted: false,
                isGhost: true,
            },
        ],
        devices: [],
        midiFx: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText(/Clips/i)).toBeInTheDocument();
    });

    it('should show clip count in header', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText('Clips (2)')).toBeInTheDocument();
    });

    it('should show empty state when no clips exist', () => {
        const trackNoClips = { ...mockTrack, clips: [] };
        render(<TrackClipsSection track={trackNoClips} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText(/No clips on this track/i)).toBeInTheDocument();
    });

    it('should display clip names', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText('Clip 1')).toBeInTheDocument();
        expect(screen.getByText('Clip 2')).toBeInTheDocument();
    });

    it('should display bar range for clips', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText(/bar 1–5/)).toBeInTheDocument();
        expect(screen.getByText(/bar 5–9/)).toBeInTheDocument();
    });

    it('should call onSelectClip when clip is clicked', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        const firstCard = choiceCards[0];
        if (!firstCard) {
            throw new Error('expected a choice card');
        }
        fireEvent.click(firstCard);
        expect(mockOnSelectClip).toHaveBeenCalledWith('clip-1');
    });

    it('should show ghost badge for ghost clips', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText('Ghost')).toBeInTheDocument();
    });

    it('should render accept button for ghost clips', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText('Accept')).toBeInTheDocument();
    });

    it('should render dismiss button for ghost clips', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        expect(screen.getByText('Dismiss')).toBeInTheDocument();
    });

    it('should call acceptGhostClip when accept is clicked', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        const acceptButton = screen.getByText('Accept');
        fireEvent.click(acceptButton);
        expect(mockAcceptGhostClip).toHaveBeenCalledWith('clip-2');
    });

    it('should call dismissGhostClip when dismiss is clicked', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        const dismissButton = screen.getByText('Dismiss');
        fireEvent.click(dismissButton);
        expect(mockDismissGhostClip).toHaveBeenCalledWith('clip-2');
    });

    it('should have dashed border for ghost clips', () => {
        render(<TrackClipsSection track={mockTrack} onSelectClip={mockOnSelectClip} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        const ghostCard = choiceCards[1];
        if (!ghostCard) {
            throw new Error('expected a ghost choice card');
        }
        expect(ghostCard.className).toContain('dashed');
    });
});

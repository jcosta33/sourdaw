import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackAlternativesSection } from './TrackAlternativesSection';
import type { Track } from '../../../models/TrackViewTypes';

// Mock external dependencies
const mockHandleCreateTrackAlternative = vi.fn();
vi.mock('#/modules/Command/useCases/trackAlternativeHandlers', () => ({
    handleCreateTrackAlternative: (...args: unknown[]) => mockHandleCreateTrackAlternative(...args),
    handleSwitchTrackAlternative: vi.fn(),
    handleDeleteTrackAlternative: vi.fn(),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        title,
        actions,
    }: {
        title?: string;
        actions?: React.ReactNode;
    }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({ children }: { children: React.ReactNode }) => (
        <span data-testid="micro-badge">{children}</span>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
    }: {
        children: React.ReactNode;
        onClick?: (e?: React.MouseEvent) => void;
        variant?: string;
        size?: string;
    }) => (
        <button data-testid="button" data-variant={variant} data-size={size} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../../components/Inspector/ChoiceCard', () => ({
    ChoiceCard: ({
        children,
        selected,
        onClick,
    }: {
        children: React.ReactNode;
        selected?: boolean;
        onClick?: () => void;
    }) => (
        <div data-testid="choice-card" data-selected={selected} onClick={onClick}>
            {children}
        </div>
    ),
}));

describe('TrackAlternativesSection', () => {
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
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
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
        alternatives: [
            { id: 'alt-1', name: 'Alternative 1', clips: [] },
            { id: 'alt-2', name: 'Alternative 2', clips: [{ id: 'clip-1', trackId: 'track-1', name: 'Clip 1', startBeat: 0, endBeat: 16, type: 'audio', fadeInBeats: 0, fadeOutBeats: 0, gain: 1, color: '#ff0000', locked: false, muted: false }] },
        ],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        expect(screen.getByText('Alternatives')).toBeInTheDocument();
    });

    it('should display all alternatives', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        expect(screen.getByText('Alternative 1')).toBeInTheDocument();
        expect(screen.getByText('Alternative 2')).toBeInTheDocument();
    });

    it('should show clip count badge for alternatives', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        const badges = screen.getAllByTestId('micro-badge');
        expect(badges.length).toBe(2);
        expect(badges[0]).toHaveTextContent('0c');
        expect(badges[1]).toHaveTextContent('1c');
    });

    it('should mark active alternative as selected', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        const choiceCards = screen.getAllByTestId('choice-card');
        expect(choiceCards[0]).toHaveAttribute('data-selected', 'true');
        expect(choiceCards[1]).toHaveAttribute('data-selected', 'false');
    });

    it('should render create button', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        expect(screen.getByLabelText(/Create new alternative/i)).toBeInTheDocument();
    });

    it('should not show delete button when only one alternative exists', () => {
        const trackWithOneAlt = { ...mockTrack, alternatives: [mockTrack.alternatives[0]] };
        render(<TrackAlternativesSection track={trackWithOneAlt} />);
        const deleteButtons = screen.queryAllByLabelText(/Delete/i);
        expect(deleteButtons.length).toBe(0);
    });

    it('should show delete buttons when multiple alternatives exist', () => {
        render(<TrackAlternativesSection track={mockTrack} />);
        const deleteButtons = screen.queryAllByLabelText(/Delete/i);
        expect(deleteButtons.length).toBe(2);
    });
});

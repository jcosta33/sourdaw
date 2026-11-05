import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { TrackAlternativesSection } from '../TrackAlternativesSection';

import type { Clip, Track } from '../../../../models/TrackViewTypes';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
}));

function makeClip(id: string): Clip {
    return {
        id,
        trackId: 'track-1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

describe('TrackAlternativesSection', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
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
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [
            { id: 'alt-1', name: 'Alternative 1', clips: [] },
            { id: 'alt-2', name: 'Alternative 2', clips: [] },
        ],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);
        expect(document.body).toBeTruthy();
    });

    it('should render one card per alternative', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);
        expect(screen.getByText('Alternative 1')).toBeInTheDocument();
        expect(screen.getByText('Alternative 2')).toBeInTheDocument();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('creates a new alternative through the user dispatch wrapper', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);

        fireEvent.click(screen.getByRole('button', { name: 'Create new alternative' }));

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'createTrackAlternative',
            payload: { trackId: 'track-1', name: 'Alt 3', duplicateActive: false },
        });
    });

    it('switches to a non-active alternative through the user dispatch wrapper', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);

        // ChoiceCard is an interactive div without a role; the card carrying the
        // alternative's name is the click target.
        const alt2Card = screen.getByText('Alternative 2').closest('.cursor-pointer');
        expect(alt2Card).not.toBeNull();
        fireEvent.click(alt2Card!);

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'switchTrackAlternative',
            payload: { trackId: 'track-1', alternativeId: 'alt-2' },
        });
    });

    it('deletes an alternative through the user dispatch wrapper without switching', () => {
        renderWithTooltip(<TrackAlternativesSection track={mockTrack} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Alternative 2' }));

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'deleteTrackAlternative',
            payload: { trackId: 'track-1', alternativeId: 'alt-2' },
        });
    });

    it("counts the active alternative's clips from the track, not its stale stored copy", () => {
        const track: Track = {
            ...mockTrack,
            clips: [makeClip('live-1'), makeClip('live-2')],
            alternatives: [
                { id: 'alt-1', name: 'Alternative 1', clips: [makeClip('removed')] },
                {
                    id: 'alt-2',
                    name: 'Alternative 2',
                    clips: [makeClip('parked-1'), makeClip('parked-2'), makeClip('parked-3')],
                },
            ],
        };

        renderWithTooltip(<TrackAlternativesSection track={track} />);

        expect(screen.getByText('2c')).toBeInTheDocument();
        expect(screen.getByText('3c')).toBeInTheDocument();
        expect(screen.queryByText('1c')).not.toBeInTheDocument();
    });
});

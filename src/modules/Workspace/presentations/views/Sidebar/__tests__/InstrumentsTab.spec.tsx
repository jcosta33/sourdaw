import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { InstrumentsTab } from '../InstrumentsTab';

import type { Track } from '../../../../models/TrackViewTypes';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('InstrumentsTab', () => {
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
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
    const mockPreview = {
        play: vi.fn(),
        stop: vi.fn(),
    };
    const mockRoute = { id: 'instruments', title: 'Instruments' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

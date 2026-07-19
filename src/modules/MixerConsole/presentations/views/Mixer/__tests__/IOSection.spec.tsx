import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { IOSection } from '../IOSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    setTrackOutput: vi.fn(),
    tracks: [] as Track[],
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setTrackOutput: mocks.setTrackOutput,
}));

vi.mock('../../../hooks/useTracks', () => ({
    useTracks: () => ({ tracks: mocks.tracks, selectedTrackId: null }),
}));

const baseTrack: Track = {
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

const makeBus = (overrides: Partial<Track> = {}): Track => ({
    ...baseTrack,
    id: 'bus-1',
    kind: 'bus',
    name: 'Bus',
    ...overrides,
});

describe('IOSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = [];
    });

    it('shows "MIDI In" for a midi track and "Default" for an audio track', () => {
        const { rerender } = render(<IOSection track={{ ...baseTrack, kind: 'midi' }} />);
        expect(screen.getByText('MIDI In')).toBeInTheDocument();

        rerender(<IOSection track={{ ...baseTrack, kind: 'audio' }} />);
        expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('shows "Master" as the output label when routed to master', () => {
        render(<IOSection track={{ ...baseTrack, outputId: 'master' }} />);
        expect(screen.getByRole('button', { name: 'Master' })).toBeInTheDocument();
    });

    it('shows the bus name as the output label when routed to a bus', () => {
        mocks.tracks = [makeBus({ id: 'bus-7', name: 'Reverb Bus' })];
        render(<IOSection track={{ ...baseTrack, outputId: 'bus-7' }} />);
        expect(screen.getByRole('button', { name: 'Reverb Bus' })).toBeInTheDocument();
    });

    it('opens a listbox of output targets on click, excluding the track itself, and marks the active one', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' }), makeBus({ id: 'bus-2', name: 'Delay' })];
        const track: Track = { ...baseTrack, id: 'bus-1', kind: 'bus', outputId: 'bus-2' };

        render(<IOSection track={track} />);

        const trigger = screen.getByRole('button', { name: 'Delay' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const listbox = screen.getByRole('listbox', { name: 'Output routing' });
        expect(listbox).toBeInTheDocument();

        // Master and Delay (bus-2) are valid targets; Reverb (the track itself, bus-1) is excluded.
        expect(screen.getByRole('option', { name: 'Master' })).toBeInTheDocument();
        const activeOption = screen.getByRole('option', { name: 'Delay' });
        expect(activeOption).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('option', { name: 'Reverb' })).not.toBeInTheDocument();
    });

    it('calls setTrackOutput with the track id and chosen target, then closes the listbox', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', outputId: 'master' };

        render(<IOSection track={track} />);
        fireEvent.click(screen.getByRole('button', { name: 'Master' }));
        fireEvent.click(screen.getByRole('option', { name: 'Reverb' }));

        expect(mocks.setTrackOutput).toHaveBeenCalledWith('track-9', 'bus-1');
        expect(screen.queryByRole('listbox', { name: 'Output routing' })).not.toBeInTheDocument();
    });
});

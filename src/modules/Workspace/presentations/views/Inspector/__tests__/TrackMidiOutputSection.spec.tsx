import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackMidiOutputSection } from '../TrackMidiOutputSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockUpdateTrack = vi.fn();

const mockToggleChordTrackFollow = vi.fn();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        updateTrack: (...args: unknown[]) => mockUpdateTrack(...args),
        toggleChordTrackFollow: (...args: unknown[]) => mockToggleChordTrackFollow(...args),
    };
});

vi.mock('#/components/daw/DawCompactCheckbox', () => ({
    DawCompactCheckbox: ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
        <input type="checkbox" data-testid="checkbox" checked={checked} onChange={onChange} />
    ),
}));

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        children,
    }: {
        value: string;
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
        children: React.ReactNode;
    }) => (
        <select data-testid="select" value={value} onChange={onChange}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

describe('TrackMidiOutputSection', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'midi',
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
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    const mockAllTracks: Track[] = [mockTrack, { ...mockTrack, id: 'track-2', name: 'Destination Track' }];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        expect(screen.getByText('MIDI Output')).toBeInTheDocument();
    });

    it('should render output destination select', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        expect(screen.getByTestId('select')).toBeInTheDocument();
    });

    it('should show "No MIDI routing" option', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        expect(screen.getByText('No MIDI routing')).toBeInTheDocument();
    });

    it('should show other MIDI tracks in select', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        expect(screen.getByText('Destination Track')).toBeInTheDocument();
    });

    it('should not show current track in select options', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        const options = screen.getAllByRole('option');
        const optionTexts = options.map((opt) => opt.textContent);
        expect(optionTexts).not.toContain('Test Track');
    });

    it('should call updateTrack with the new destination when selected', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: 'track-2' } });
        expect(mockUpdateTrack).toHaveBeenCalledWith('track-1', expect.any(Function));
        const updater = mockUpdateTrack.mock.calls[0][1] as (t: Track) => Track;
        expect(updater(mockTrack).midiOutputTrackId).toBe('track-2');
    });

    it('should call updateTrack with null when "No MIDI routing" is selected', () => {
        const trackWithOutput = { ...mockTrack, midiOutputTrackId: 'track-2' };
        render(<TrackMidiOutputSection track={trackWithOutput} allTracks={mockAllTracks} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: '' } });
        expect(mockUpdateTrack).toHaveBeenCalledWith('track-1', expect.any(Function));
        const updater = mockUpdateTrack.mock.calls[0][1] as (t: Track) => Track;
        expect(updater(trackWithOutput).midiOutputTrackId).toBe(null);
    });

    it('should render follow chord track checkbox', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        expect(screen.getByTestId('checkbox')).toBeInTheDocument();
    });

    it('should show follow chord track as unchecked by default', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        const checkbox = screen.getByTestId('checkbox');
        expect(checkbox).not.toBeChecked();
    });

    it('should show follow chord track as checked when enabled', () => {
        const trackWithFollow = { ...mockTrack, followChordTrack: true };
        render(<TrackMidiOutputSection track={trackWithFollow} allTracks={mockAllTracks} />);
        const checkbox = screen.getByTestId('checkbox');
        expect(checkbox).toBeChecked();
    });

    it('should call toggleChordTrackFollow when checkbox is clicked', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        const checkbox = screen.getByTestId('checkbox');
        fireEvent.click(checkbox);
        expect(mockToggleChordTrackFollow).toHaveBeenCalledWith('track-1');
    });

    it('should render two surface cards', () => {
        render(<TrackMidiOutputSection track={mockTrack} allTracks={mockAllTracks} />);
        const surfaceCards = screen.getAllByTestId('surface-card');
        expect(surfaceCards.length).toBe(2);
    });

    it('should show routing description when output is set', () => {
        const trackWithOutput = { ...mockTrack, midiOutputTrackId: 'track-2' };
        render(<TrackMidiOutputSection track={trackWithOutput} allTracks={mockAllTracks} />);
        expect(screen.getByText(/MIDI events from this track are routed/i)).toBeInTheDocument();
    });
});

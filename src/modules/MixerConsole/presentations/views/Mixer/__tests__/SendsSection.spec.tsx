import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SendsSection } from '../SendsSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    setSend: vi.fn(),
    toggleSendPreFader: vi.fn(),
    tracks: [] as Track[],
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setSend: mocks.setSend,
    toggleSendPreFader: mocks.toggleSendPreFader,
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
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
};

const makeBus = (overrides: Partial<Track> = {}): Track => ({
    ...baseTrack,
    id: 'bus-1',
    kind: 'bus',
    name: 'Bus',
    ...overrides,
});

describe('SendsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = [];
    });

    it('renders nothing when the project has no buses', () => {
        const { container } = render(<SendsSection track={baseTrack} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders one send row per bus, labeled with the bus name and current send level', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' }), makeBus({ id: 'bus-2', name: 'Delay' })];
        const track: Track = { ...baseTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };

        render(<SendsSection track={track} />);

        expect(screen.getByText('Reverb')).toBeInTheDocument();
        expect(screen.getByText('Delay')).toBeInTheDocument();
        // FX-7: the control is linear in dB, not in amplitude. A stored level of
        // 0.5 is -6.02 dB, which sits near the top of a -60 dB travel (~90),
        // not at the midpoint the old linear law put it at.
        expect(screen.getByRole('slider', { name: 'Send to Reverb' })).toHaveAttribute('aria-valuenow', '90');
        // No matching send entry for bus-2 -> defaults to 0.
        expect(screen.getByRole('slider', { name: 'Send to Delay' })).toHaveAttribute('aria-valuenow', '0');
    });

    it('calls setSend with the track id, bus id, and normalized level on slider edit', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] };

        render(<SendsSection track={track} />);

        const slider = screen.getByRole('slider', { name: 'Send to Reverb' });
        fireEvent.doubleClick(slider);
        // Stored 0.2 is -13.98 dB, which reads as position 77 on the dB travel.
        const input = screen.getByDisplayValue('77');
        fireEvent.change(input, { target: { value: '65' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // Position 65 of a -60 dB travel is -21 dB, i.e. a gain of 0.0891 — the
        // old linear law would have stored 0.65 for the same control position.
        const [trackId, busId, level] = mocks.setSend.mock.calls[0]!;
        expect(trackId).toBe('track-9');
        expect(busId).toBe('bus-1');
        expect(level).toBeCloseTo(0.0891, 4);
    });

    it('shows POST for a post-fader send and toggles it to pre-fader on click', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };

        render(<SendsSection track={track} />);

        const toggle = screen.getByRole('button', { name: 'Toggle send to Reverb pre-fader' });
        expect(toggle).toHaveTextContent('POST');

        fireEvent.click(toggle);

        expect(mocks.toggleSendPreFader).toHaveBeenCalledWith('track-9', 'bus-1');
    });

    it('shows PRE for a pre-fader send and toggles it to post-fader on click', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.5, preFader: true }] };

        render(<SendsSection track={track} />);

        const toggle = screen.getByRole('button', { name: 'Toggle send to Reverb post-fader' });
        expect(toggle).toHaveTextContent('PRE');

        fireEvent.click(toggle);

        expect(mocks.toggleSendPreFader).toHaveBeenCalledWith('track-9', 'bus-1');
    });
});

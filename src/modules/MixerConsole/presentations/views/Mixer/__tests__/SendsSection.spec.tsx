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
        expect(screen.getByRole('slider', { name: 'Send to Reverb' })).toHaveAttribute('aria-valuenow', '50');
        // No matching send entry for bus-2 -> defaults to 0.
        expect(screen.getByRole('slider', { name: 'Send to Delay' })).toHaveAttribute('aria-valuenow', '0');
    });

    it('calls setSend with the track id, bus id, and normalized level on slider edit', () => {
        mocks.tracks = [makeBus({ id: 'bus-1', name: 'Reverb' })];
        const track: Track = { ...baseTrack, id: 'track-9', sends: [{ busId: 'bus-1', level: 0.2, preFader: false }] };

        render(<SendsSection track={track} />);

        const slider = screen.getByRole('slider', { name: 'Send to Reverb' });
        fireEvent.doubleClick(slider);
        const input = screen.getByDisplayValue('20');
        fireEvent.change(input, { target: { value: '65' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mocks.setSend).toHaveBeenCalledWith('track-9', 'bus-1', 0.65);
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

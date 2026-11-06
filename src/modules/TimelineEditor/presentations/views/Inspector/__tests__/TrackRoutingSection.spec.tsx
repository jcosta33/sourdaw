import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackRoutingSection } from '../TrackRoutingSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mockUseTracks = vi.fn((): { tracks: Track[] } => ({ tracks: [] }));
vi.mock('../../../hooks/useTracks', () => ({
    useTracks: () => mockUseTracks(),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/daw/DawReadoutRow', () => ({
    DawReadoutRow: ({ label, value }: { label: string; value: string }) => (
        <div data-testid="readout-row">
            <span>{label}</span>
            <span>{value}</span>
        </div>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

const baseTrack: Track = {
    id: 'track-1',
    name: 'Lead',
    kind: 'midi',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
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

const makeTrack = (overrides: Partial<Track>): Track => ({ ...baseTrack, ...overrides });

const bus = makeTrack({ id: 'bus-1', name: 'Drum Bus', kind: 'bus', outputId: 'master' });
const master = makeTrack({ id: 'master-track', name: 'Master', kind: 'master', outputId: 'hw_out' });

describe('TrackRoutingSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseTracks.mockReturnValue({ tracks: [] });
    });

    it('keeps the Routing heading', () => {
        render(<TrackRoutingSection track={baseTrack} />);
        expect(screen.getByText('Routing')).toBeInTheDocument();
    });

    it('shows Master as the output of a track routed to master and no inputs', () => {
        mockUseTracks.mockReturnValue({ tracks: [baseTrack, bus, master] });
        render(<TrackRoutingSection track={baseTrack} />);
        expect(screen.getAllByTestId('readout-row')).toHaveLength(1);
        expect(screen.getByText('Output')).toBeInTheDocument();
        expect(screen.getByText('Master')).toBeInTheDocument();
        expect(screen.queryByText(/^Inputs?$/)).not.toBeInTheDocument();
    });

    it('shows the bus name as the output of a track routed to a bus', () => {
        const routed = makeTrack({ outputId: 'bus-1' });
        mockUseTracks.mockReturnValue({ tracks: [routed, bus] });
        render(<TrackRoutingSection track={routed} />);
        expect(screen.getByText('Drum Bus')).toBeInTheDocument();
    });

    it('lists the tracks routed into a bus as its inputs', () => {
        const routed = makeTrack({ outputId: 'bus-1' });
        const other = makeTrack({ id: 'track-2', name: 'Kick', outputId: 'master' });
        mockUseTracks.mockReturnValue({ tracks: [routed, other, bus] });
        render(<TrackRoutingSection track={bus} />);
        expect(screen.getByText('Input')).toBeInTheDocument();
        expect(screen.getByText('Lead')).toBeInTheDocument();
        expect(screen.queryByText('Kick')).not.toBeInTheDocument();
    });

    it('shows Hardware output for master and lists the tracks outputting to master', () => {
        const other = makeTrack({ id: 'track-2', name: 'Kick', outputId: 'bus-1' });
        mockUseTracks.mockReturnValue({ tracks: [baseTrack, other, bus, master] });
        render(<TrackRoutingSection track={master} />);
        expect(screen.getByText('Hardware output')).toBeInTheDocument();
        expect(screen.getByText('Inputs')).toBeInTheDocument();
        expect(screen.getByText('Lead, Drum Bus')).toBeInTheDocument();
    });

    it('lists no inputs for a track that is neither a bus nor master', () => {
        const stray = makeTrack({ id: 'track-2', name: 'Stray', outputId: 'track-1' });
        mockUseTracks.mockReturnValue({ tracks: [baseTrack, stray] });
        render(<TrackRoutingSection track={baseTrack} />);
        expect(screen.queryByText('Stray')).not.toBeInTheDocument();
    });

    it('never renders a raw output id that resolves to no track', () => {
        const orphan = makeTrack({ outputId: 'bus-gone' });
        mockUseTracks.mockReturnValue({ tracks: [orphan] });
        render(<TrackRoutingSection track={orphan} />);
        expect(screen.getByText('Unknown destination')).toBeInTheDocument();
        expect(screen.queryByText('bus-gone')).not.toBeInTheDocument();
    });
});

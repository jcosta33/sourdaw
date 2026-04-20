import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackRoutingSection } from '../TrackRoutingSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockUseStore = vi.fn(() => ({ routes: [] }));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/modules/AudioEngine/stores/audioGraphStore', () => ({
    audioGraphStore: {},
    defaultAudioGraphState: { routes: [] },
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
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

describe('TrackRoutingSection', () => {
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
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<TrackRoutingSection track={mockTrack} />);
        expect(screen.getByText('Routing')).toBeInTheDocument();
    });

    it('should show default routing message when no custom routes exist', () => {
        mockUseStore.mockReturnValue({ routes: [] });
        render(<TrackRoutingSection track={mockTrack} />);
        expect(screen.getByText(/Default routing to master/i)).toBeInTheDocument();
    });

    it('should display outgoing routes', () => {
        mockUseStore.mockReturnValue({
            routes: [{ id: 'route-1', sourceId: 'track-1', destinationId: 'bus-1', gain: 0.8 }],
        });
        render(<TrackRoutingSection track={mockTrack} />);
        expect(screen.getByText('→ bus-1')).toBeInTheDocument();
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('should display incoming routes', () => {
        mockUseStore.mockReturnValue({
            routes: [{ id: 'route-1', sourceId: 'track-2', destinationId: 'track-1', gain: 0.5 }],
        });
        render(<TrackRoutingSection track={mockTrack} />);
        expect(screen.getByText('← track-2')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should render surface cards for routes', () => {
        mockUseStore.mockReturnValue({
            routes: [{ id: 'route-1', sourceId: 'track-1', destinationId: 'bus-1', gain: 0.8 }],
        });
        render(<TrackRoutingSection track={mockTrack} />);
        expect(screen.getByTestId('surface-card')).toBeInTheDocument();
    });

    it('should render multiple routes', () => {
        mockUseStore.mockReturnValue({
            routes: [
                { id: 'route-1', sourceId: 'track-1', destinationId: 'bus-1', gain: 0.8 },
                { id: 'route-2', sourceId: 'track-1', destinationId: 'bus-2', gain: 0.6 },
            ],
        });
        render(<TrackRoutingSection track={mockTrack} />);
        const readoutRows = screen.getAllByTestId('readout-row');
        expect(readoutRows.length).toBe(2);
    });
});

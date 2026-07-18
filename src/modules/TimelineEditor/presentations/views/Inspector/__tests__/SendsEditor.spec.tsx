import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SendsEditor } from '../SendsEditor';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockSetSend = vi.fn();

const mockAddTrack = vi.fn();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        toggleSendPreFader: vi.fn(),
        setSend: (...args: unknown[]) => mockSetSend(...args),
        addTrack: (...args: unknown[]) => mockAddTrack(...args),
    };
});

const mockUseTracks = vi.fn((): { tracks: Track[] } => ({ tracks: [] }));
vi.mock('../../../hooks/useTracks', () => ({
    useTracks: () => mockUseTracks(),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({
        title,
        description,
        action,
    }: {
        title: string;
        description: string;
        action?: React.ReactNode;
    }) => (
        <div data-testid="empty-state">
            <span>{title}</span>
            <span>{description}</span>
            {action ? <div data-testid="empty-action">{action}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title }: { title?: string }) => <div data-testid="header-band">{title}</div>,
}));

vi.mock('#/components/daw/DawMicroBadge', () => ({
    DawMicroBadge: ({ children, tone }: { children: React.ReactNode; tone?: string }) => (
        <span data-testid="micro-badge" data-tone={tone}>
            {children}
        </span>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({ value, onValueChange }: { value: number[]; onValueChange: (values: number[]) => void }) => (
        <input
            type="range"
            data-testid="slider"
            value={value[0]}
            onChange={(event) => onValueChange([Number(event.target.value)])}
        />
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button data-testid="button" onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/ControlHeader', () => ({
    ControlHeader: ({ label, value }: { label: string; value?: React.ReactNode }) => (
        <div data-testid="control-header">
            <span>{label}</span>
            {value ? <div data-testid="control-value">{value}</div> : null}
        </div>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

describe('SendsEditor', () => {
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
        render(<SendsEditor track={mockTrack} />);
        expect(screen.getByText('Sends')).toBeInTheDocument();
    });

    it('should show empty state when no bus tracks exist', () => {
        mockUseTracks.mockReturnValue({ tracks: [] });
        render(<SendsEditor track={mockTrack} />);
        expect(screen.getByText(/No bus tracks yet/i)).toBeInTheDocument();
    });

    it('should render bus send controls when bus tracks exist', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        render(<SendsEditor track={mockTrack} />);
        expect(screen.getByText('Bus 1')).toBeInTheDocument();
    });

    it('should render slider for send level control', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        render(<SendsEditor track={mockTrack} />);
        expect(screen.getByTestId('slider')).toBeInTheDocument();
    });

    it('should display send level percentage', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        const trackWithSend = { ...mockTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };
        render(<SendsEditor track={trackWithSend} />);
        expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('should show PRE badge for pre-fader sends', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        const trackWithPreSend = { ...mockTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: true }] };
        render(<SendsEditor track={trackWithPreSend} />);
        expect(screen.getByText('PRE')).toBeInTheDocument();
    });

    it('should show POST badge for post-fader sends', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        const trackWithPostSend = { ...mockTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };
        render(<SendsEditor track={trackWithPostSend} />);
        expect(screen.getByText('POST')).toBeInTheDocument();
    });

    it('should call addTrack when create bus button is clicked', () => {
        mockUseTracks.mockReturnValue({ tracks: [] });
        render(<SendsEditor track={mockTrack} />);
        const createButton = screen.getByText(/Create Bus/i);
        fireEvent.click(createButton);
        expect(mockAddTrack).toHaveBeenCalled();
    });
});

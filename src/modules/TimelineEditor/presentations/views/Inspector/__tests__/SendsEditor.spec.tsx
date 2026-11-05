import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { sendPositionToLevel } from '#/utils/audioLevelLaw';

import { SendsEditor } from '../SendsEditor';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockPreviewSend = vi.fn();
const mockExecuteAppAction = vi.fn().mockResolvedValue(undefined);

const mockExecuteUserAppAction = vi.fn().mockResolvedValue(undefined);
// The action-routed graph pulls more of the barrel in than the view itself
// calls, so the mock has to supply every name the graph imports.
vi.mock('#/modules/Command/useCases', () => ({
    commitRedoInverseCapture: vi.fn(),
    readUndoEntryForInverse: vi.fn<typeof import('#/modules/Command/useCases').readUndoEntryForInverse>(() => null),

    executeUserAppAction: (...args: unknown[]) => mockExecuteUserAppAction(...args),
    getExecutableAppActionEffect: vi.fn(() => null),
    executeAppAction: (...args: unknown[]) => mockExecuteAppAction(...args),
    executeAppActionBatch: vi.fn().mockResolvedValue([]),
    pushUndoEntry: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

// The gesture previews on the engine through Routing's setSend; project state
// is written only by the dispatched action.
vi.mock('#/modules/Routing/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Routing/useCases')>();
    return {
        ...actual,
        setSend: (...args: unknown[]) => mockPreviewSend(...args),
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
    Slider: ({
        value,
        onValueChange,
        onValueCommit,
        'aria-label': ariaLabel,
    }: {
        value: number[];
        onValueChange: (values: number[]) => void;
        onValueCommit: (values: number[]) => void;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            aria-label={ariaLabel}
            data-testid="slider"
            value={value[0]}
            onChange={(event) => onValueChange([Number(event.target.value)])}
            onMouseUp={(event) => onValueCommit([Number(event.currentTarget.value)])}
        />
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        'aria-label'?: string;
    }) => (
        <button data-testid="button" onClick={onClick} aria-label={ariaLabel}>
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

    // FX-7: the readout is decibels, not a percentage of a linear amplitude —
    // "50%" claimed half as loud when 0.5 gain is only -6 dB down.
    it('reads out the send level in decibels', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        const trackWithSend = { ...mockTrack, sends: [{ busId: 'bus-1', level: 0.5, preFader: false }] };
        render(<SendsEditor track={trackWithSend} />);
        expect(screen.getByText('-6.0 dB')).toBeInTheDocument();
    });

    it('reads out a closed send as silence rather than a finite level', () => {
        const busTrack: Track = { ...mockTrack, id: 'bus-1', name: 'Bus 1', kind: 'bus' };
        mockUseTracks.mockReturnValue({ tracks: [busTrack] });
        render(<SendsEditor track={{ ...mockTrack, sends: [] }} />);
        expect(screen.getByText('-∞ dB')).toBeInTheDocument();
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

    describe('undoable send edits', () => {
        const bus = (id: string, over: Partial<Track> = {}): Track => ({
            ...mockTrack,
            id,
            name: id,
            kind: 'bus',
            ...over,
        });
        const sendTo = (busId: string, over: { level?: number; preFader?: boolean } = {}): Track['sends'][number] => ({
            busId,
            level: 0.5,
            preFader: false,
            ...over,
        });

        it('previews a slider drag on the engine only and commits one setSend on release', async () => {
            mockUseTracks.mockReturnValue({ tracks: [bus('bus-1')] });
            render(<SendsEditor track={{ ...mockTrack, sends: [sendTo('bus-1')] }} />);

            const slider = screen.getByTestId('slider');
            fireEvent.change(slider, { target: { value: '40' } });

            expect(mockPreviewSend).toHaveBeenCalledOnce();
            expect(mockExecuteAppAction).not.toHaveBeenCalled();

            await act(async () => {
                fireEvent.mouseUp(slider);
            });

            expect(mockExecuteAppAction).toHaveBeenCalledOnce();
            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setSend',
                payload: {
                    trackId: 'track-1',
                    busId: 'bus-1',
                    level: sendPositionToLevel(40),
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            });
        });

        it('commits addSend when the track has no send to that bus yet', async () => {
            mockUseTracks.mockReturnValue({ tracks: [bus('bus-1')] });
            render(<SendsEditor track={mockTrack} />);

            const slider = screen.getByTestId('slider');
            fireEvent.change(slider, { target: { value: '40' } });
            await act(async () => {
                fireEvent.mouseUp(slider);
            });

            expect(mockExecuteAppAction).toHaveBeenCalledOnce();
            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'addSend',
                payload: { trackId: 'track-1', busId: 'bus-1', level: sendPositionToLevel(40) },
            });
        });

        it('commits the PRE/POST click as one setSend that flips only the tap point', () => {
            mockUseTracks.mockReturnValue({ tracks: [bus('bus-1')] });
            render(<SendsEditor track={{ ...mockTrack, sends: [sendTo('bus-1', { preFader: false })] }} />);

            fireEvent.click(screen.getByRole('button', { name: 'Toggle send to bus-1 pre-fader' }));

            expect(mockExecuteAppAction).toHaveBeenCalledOnce();
            expect(mockExecuteAppAction).toHaveBeenCalledWith({
                type: 'setSend',
                payload: {
                    trackId: 'track-1',
                    busId: 'bus-1',
                    level: 0.5,
                    preFader: true,
                    expectedLevel: 0.5,
                    expectedPreFader: false,
                },
            });
        });

        it('does not offer the track itself or a bus that would close a routing loop', () => {
            // bus-loop outputs into the edited track, so a send there is a cycle.
            const edited = bus('bus-self', { sends: [] });
            mockUseTracks.mockReturnValue({
                tracks: [edited, bus('bus-ok'), bus('bus-loop', { outputId: 'bus-self' })],
            });
            render(<SendsEditor track={edited} />);

            expect(screen.getByRole('slider', { name: 'Send to bus-ok' })).toBeInTheDocument();
            expect(screen.queryByRole('slider', { name: 'Send to bus-self' })).not.toBeInTheDocument();
            expect(screen.queryByRole('slider', { name: 'Send to bus-loop' })).not.toBeInTheDocument();
        });

        it('still lists a bus the track already sends to even when it would now close a loop', () => {
            const edited = bus('bus-self', { sends: [sendTo('bus-loop')] });
            mockUseTracks.mockReturnValue({ tracks: [edited, bus('bus-loop', { outputId: 'bus-self' })] });
            render(<SendsEditor track={edited} />);

            expect(screen.getByText('bus-loop')).toBeInTheDocument();
        });
    });

    it('dispatches the createBus app action when create bus button is clicked', () => {
        mockUseTracks.mockReturnValue({ tracks: [] });
        render(<SendsEditor track={mockTrack} />);
        const createButton = screen.getByText(/Create Bus/i);
        fireEvent.click(createButton);
        // The registered bus-creation action, not the bare addTrack use case,
        // so the bus enters undo history (#4618).
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith({
            type: 'createBus',
            payload: { name: 'Bus 1' },
        });
    });
});

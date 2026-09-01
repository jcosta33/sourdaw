import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scrollTimelineViewportHorizontallyFromWheel } from '#/modules/Arrangement/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { AutomationBottomPanel } from '../AutomationBottomPanel';

const mocks = vi.hoisted(() => ({
    trackStore: { value: { tracks: [] as Track[], selectedTrackId: null as string | null } },
    timelineViewStore: {
        value: {
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
        },
    },
    automationStore: { value: { lanes: [] } },
    workspaceStore: { value: { trackListOpen: true, trackListWidth: 200 } },
    rawScrollTimeline: vi.fn(),
    scrollTimelineViewportHorizontallyFromWheel: vi.fn(),
    setAutomationMode: vi.fn(),
    addAutomationLane: vi.fn(),
    toggleLaneCollapsed: vi.fn(),
    removeAutomationLane: vi.fn(),
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="empty-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({
        children,
        compact,
        className,
    }: {
        children: React.ReactNode;
        compact?: boolean;
        className?: string;
    }) => (
        <div className={className} data-compact={compact}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('#/modules/Arrangement/presentations/views', () => ({
    BeatRulerBar: () => <div data-testid="beat-ruler">Beat Ruler</div>,
    TimelineChromeSurface: ({
        children,
        className,
        tone,
    }: {
        children?: React.ReactNode;
        className?: string;
        tone?: string;
    }) => (
        <div className={className} data-tone={tone}>
            {children}
        </div>
    ),
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: mocks.automationStore,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    timelineViewStore: mocks.timelineViewStore,
    scrollTimeline: mocks.rawScrollTimeline,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setAutomationMode: mocks.setAutomationMode,
    scrollTimelineViewportHorizontallyFromWheel: mocks.scrollTimelineViewportHorizontallyFromWheel,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: mocks.workspaceStore,
    defaultWorkspaceState: { trackListOpen: true, trackListWidth: 200 },
}));

vi.mock('../AutomationView/AutomationLaneRow', () => ({
    AutomationLaneRow: ({ lane }: { lane: { id: string } }) => (
        <div data-testid={`lane-row-${lane.id}`}>Lane {lane.id}</div>
    ),
}));

vi.mock('../AutomationView/AutomationSidebarCell', () => ({
    AutomationSidebarCell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('../AutomationView/AutomationControls', () => ({
    AutomationAddLaneControl: ({ params }: { params: { id: string; name: string }[] }) => (
        <div data-testid="add-lane-control">
            {params.map((param) => (
                <span key={param.id}>{param.name}</span>
            ))}
        </div>
    ),
    AutomationModeControl: ({ automationMode, laneCount }: { automationMode: string; laneCount: number }) => (
        <div data-testid="mode-control" data-mode={automationMode} data-count={laneCount} />
    ),
}));

vi.mock('../../helpers/automationViewHelpers', () => ({
    getAutomatableParams: vi.fn(() => [
        { id: 'volume', name: 'Volume' },
        { id: 'pan', name: 'Pan' },
    ]),
    LANE_HEIGHT: 120,
}));

vi.mock('../../../models/AutomationViewTypes', () => ({
    // Type only
}));

vi.mock('#/modules/Automation/useCases', () => ({
    addAutomationLane: mocks.addAutomationLane,
    toggleLaneCollapsed: mocks.toggleLaneCollapsed,
    removeAutomationLane: mocks.removeAutomationLane,
    getAutomationLaneCeiling: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { value: unknown }, fallback?: unknown) => store.value ?? fallback),
}));

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: 'var(--color-palette-steel)',
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
    height: 64,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'main',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    ...overrides,
});

const renderSelectedTrack = () => {
    mocks.trackStore.value = {
        tracks: [makeTrack()],
        selectedTrackId: 'track-1',
    };
    mocks.workspaceStore.value = { trackListOpen: false, trackListWidth: 200 };

    const result = render(<AutomationBottomPanel />);
    const laneViewport = result.container.querySelector('.overflow-y-auto');
    if (!laneViewport) {
        throw new Error('Expected automation lane viewport to render');
    }

    return { laneViewport, ...result };
};

describe('AutomationBottomPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe(): void {}
                disconnect(): void {}
            }
        );
        mocks.trackStore.value = { tracks: [], selectedTrackId: null };
        mocks.timelineViewStore.value = {
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
        };
        mocks.automationStore.value = { lanes: [] };
        mocks.workspaceStore.value = { trackListOpen: true, trackListWidth: 200 };
    });

    it('should render without crashing', () => {
        render(<AutomationBottomPanel />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
    });

    it('should show blocked state when no track is selected', () => {
        render(<AutomationBottomPanel />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No track selected')).toBeInTheDocument();
    });

    it('should route horizontal wheel movement through the Arrangement horizontal scroll use case', () => {
        const { laneViewport } = renderSelectedTrack();

        fireEvent.wheel(laneViewport, {
            deltaX: 32,
            deltaY: 4,
            shiftKey: false,
        });

        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledTimes(1);
        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledWith({
            deltaX: 32,
            deltaY: 4,
            shiftKey: false,
        });
        expect(mocks.rawScrollTimeline).not.toHaveBeenCalled();
    });

    it('should route shift wheel movement through the Arrangement horizontal scroll use case', () => {
        const { laneViewport } = renderSelectedTrack();

        fireEvent.wheel(laneViewport, {
            deltaX: 0,
            deltaY: 28,
            shiftKey: true,
        });

        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledTimes(1);
        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledWith({
            deltaX: 0,
            deltaY: 28,
            shiftKey: true,
        });
        expect(mocks.rawScrollTimeline).not.toHaveBeenCalled();
    });

    it('should delegate vertical-only wheel movement to the Arrangement horizontal scroll policy', () => {
        const { laneViewport } = renderSelectedTrack();

        fireEvent.wheel(laneViewport, {
            deltaX: 2,
            deltaY: 36,
            shiftKey: false,
        });

        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledTimes(1);
        expect(scrollTimelineViewportHorizontallyFromWheel).toHaveBeenCalledWith({
            deltaX: 2,
            deltaY: 36,
            shiftKey: false,
        });
        expect(mocks.rawScrollTimeline).not.toHaveBeenCalled();
    });
});

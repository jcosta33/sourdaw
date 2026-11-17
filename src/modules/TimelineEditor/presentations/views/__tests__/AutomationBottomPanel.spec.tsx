import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { scrollTimelineViewportHorizontallyFromWheel } from '#/modules/Arrangement/useCases';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
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
    automationStore: { value: { lanes: [] as AutomationLane[] } },
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
    AutomationLaneRow: ({ lane, containerWidth }: { lane: { id: string }; containerWidth: number }) => (
        <div data-testid={`lane-row-${lane.id}`} data-width={containerWidth}>
            Lane {lane.id}
        </div>
    ),
}));

vi.mock('../AutomationView/AutomationSidebarCell', () => ({
    AutomationSidebarCell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('../AutomationView/AutomationControls', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../AutomationView/AutomationControls')>();
    return {
        ...actual,
        AutomationModeControl: ({ automationMode, laneCount }: { automationMode: string; laneCount: number }) => (
            <div data-testid="mode-control" data-mode={automationMode} data-count={laneCount} />
        ),
    };
});

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

    it('measures the mounted lane viewport after selecting a track and toggling the sidebar', () => {
        const observed = new Map<Element, (width: number) => void>();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(readonly receive: (entries: { contentRect: { width: number } }[]) => void) {}
                observe(element: Element) {
                    observed.set(element, (width) => this.receive([{ contentRect: { width } }]));
                }
                disconnect() {
                    observed.clear();
                }
            }
        );
        const width = vi
            .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
            .mockImplementation(() => (mocks.workspaceStore.value.trackListOpen ? 480 : 680));
        try {
            const view = render(<AutomationBottomPanel />);
            expect(screen.getByText('No track selected')).toBeVisible();
            mocks.trackStore.value = { tracks: [makeTrack()], selectedTrackId: 'track-1' };
            view.rerender(<AutomationBottomPanel />);
            expect(screen.getByText('No automation lanes yet')).toBeVisible();

            mocks.automationStore.value.lanes = [
                {
                    id: 'gain-lane',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 2,
                },
            ];
            for (const open of [true, false, true]) {
                mocks.workspaceStore.value.trackListOpen = open;
                view.rerender(<AutomationBottomPanel />);
                const row = screen.getByTestId('lane-row-gain-lane');
                expect(row).toHaveAttribute('data-width', open ? '480' : '680');
                expect(observed.size).toBe(1);
                const [element, resize] = [...observed][0]!;
                expect(element.contains(row)).toBe(true);
                act(() => resize(321));
                expect(row).toHaveAttribute('data-width', '321');
            }
        } finally {
            width.mockRestore();
        }
    });

    it('lets the full track name wrap in its own header row', () => {
        const name = 'Long unbroken track identity with additional take and microphone details';
        mocks.trackStore.value = { tracks: [makeTrack({ name })], selectedTrackId: 'track-1' };
        render(<AutomationBottomPanel />);
        const label = screen.getByText(name);
        expect(label).toHaveClass('break-words');
        expect(label.closest('.h-7')).toBeNull();
        expect(screen.getByTestId('mode-control')).toHaveAttribute('data-count', '0');
    });

    it('puts the add-lane action inside the empty state it explains', () => {
        const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
        try {
            renderSelectedTrack();

            const title = screen.getByText('No automation lanes yet');
            const emptyState = title.closest<HTMLElement>('.daw-empty-state-surface');
            if (emptyState === null) {
                throw new Error('Expected the real compact empty-state surface');
            }
            expect(emptyState).toHaveClass('gap-1.5', 'p-4');
            expect(title).toHaveClass('text-xs');
            const addLaneButton = within(emptyState).getByRole('button', { name: 'Add Lane' });
            expect(addLaneButton).toBeInTheDocument();

            fireEvent.click(addLaneButton);
            const menu = screen.getByRole('menu');
            expect(menu).toHaveTextContent('Add parameter');
            fireEvent.click(within(menu).getByRole('button', { name: 'Volume' }));

            expect(mocks.addAutomationLane).toHaveBeenCalledWith('track-1', 'volume', 'Volume');
        } finally {
            clientWidth.mockRestore();
        }
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

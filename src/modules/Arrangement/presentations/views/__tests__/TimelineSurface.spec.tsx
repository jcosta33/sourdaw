import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { useTimelineInteractions } from '../../hooks/useTimelineInteractions';
import { TimelineSurface } from '../TimelineSurface';

// Mock external dependencies
vi.mock('../../../useCases/initTimelineRenderer', () => ({
    initTimelineRenderer: vi.fn(() =>
        Promise.resolve({
            resize: vi.fn(),
            render: vi.fn(),
            dispose: vi.fn(),
        })
    ),
}));

vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
    setAutoScroll: vi.fn(),
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

vi.mock('../TimelineContextMenus', () => ({
    ClipContextMenu: ({ onClose }: any) => (
        <div data-testid="clip-menu">
            <button onClick={onClose}>Close</button>
        </div>
    ),
    TimelineEmptyMenu: ({ onClose }: any) => (
        <div data-testid="empty-menu">
            <button onClick={onClose}>Close</button>
        </div>
    ),
}));

vi.mock('../../hooks/useTimelineInteractions', () => ({
    useTimelineInteractions: vi.fn<() => Record<string, unknown>>(() => ({
        handleMouseDown: vi.fn<() => void>(),
        handleMouseMove: vi.fn<() => void>(),
        handleMouseUp: vi.fn<() => void>(),
        handleDoubleClick: vi.fn<() => void>(),
        handleContextMenu: vi.fn<() => void>(),
        handlePointerDown: vi.fn<() => void>(),
        handlePointerMove: vi.fn<() => void>(),
        handlePointerUp: vi.fn<() => void>(),
        handlePointerCancel: vi.fn<() => void>(),
        handleFileDrop: vi.fn<() => void>(),
        getCursor: vi.fn<() => string>(() => 'default'),
        setIsDragOver: vi.fn<() => void>(),
        isDragOver: false,
        isImporting: false,
        rubberBand: null,
        contextMenu: null,
        setContextMenu: vi.fn<() => void>(),
    })),
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: {
        value: {},
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Collaboration/presentations/views/PresenceOverlay', () => ({
    PresenceOverlay: () => <div data-testid="presence-overlay">Presence</div>,
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: {
        value: {},
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: { lanes: [] },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: {
        value: { isPlaying: false },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));

vi.mock('#/modules/Transport/stores/tempoMapStore', () => ({
    tempoMapStore: {
        value: {},
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        value: {},
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        value: { markers: [] },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/zoomOperations/onScrollToPlayhead', () => ({
    onScrollToPlayhead: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/zoomOperations/onZoomToSelection', () => ({
    onZoomToSelection: vi.fn(() => vi.fn()),
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/zoomOperations/onZoomToFit', () => ({
    onZoomToFit: vi.fn(() => vi.fn()),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineSurface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct aria attributes on canvas', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('aria-label', 'Timeline editor surface');
    });

    it('should render PresenceOverlay', () => {
        renderWithTooltip(<TimelineSurface />);
        expect(screen.getByTestId('presence-overlay')).toBeInTheDocument();
    });

    it('should handle drag over state', () => {
        const mockedUseTimelineInteractions = vi.mocked(useTimelineInteractions);
        mockedUseTimelineInteractions.mockReturnValue({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleContextMenu: vi.fn(),
            handlePointerDown: vi.fn(),
            handlePointerMove: vi.fn(),
            handlePointerUp: vi.fn(),
            handlePointerCancel: vi.fn(),
            handleFileDrop: vi.fn(),
            getCursor: vi.fn(() => 'default'),
            setIsDragOver: vi.fn(),
            isDragOver: true,
            isImporting: false,
            rubberBand: null,
            contextMenu: null,
            setContextMenu: vi.fn(),
        });

        renderWithTooltip(<TimelineSurface />);
        expect(screen.getByText('Drop audio or MIDI files here')).toBeInTheDocument();
    });

    it('should handle importing state', () => {
        const mockedUseTimelineInteractions = vi.mocked(useTimelineInteractions);
        mockedUseTimelineInteractions.mockReturnValue({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleContextMenu: vi.fn(),
            handlePointerDown: vi.fn(),
            handlePointerMove: vi.fn(),
            handlePointerUp: vi.fn(),
            handlePointerCancel: vi.fn(),
            handleFileDrop: vi.fn(),
            getCursor: vi.fn(() => 'default'),
            setIsDragOver: vi.fn(),
            isDragOver: false,
            isImporting: true,
            rubberBand: null,
            contextMenu: null,
            setContextMenu: vi.fn(),
        });

        renderWithTooltip(<TimelineSurface />);
        expect(screen.getByText('Importing audio…')).toBeInTheDocument();
    });

    it('should have relative flex container', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('relative');
        expect(container.firstChild).toHaveClass('flex-1');
    });

    it('should have overflow hidden', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('overflow-hidden');
    });
});

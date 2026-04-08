import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineSurface } from './TimelineSurface';

// Mock external dependencies
vi.mock('../../useCases/initTimelineRenderer', () => ({
    initTimelineRenderer: vi.fn(() => Promise.resolve({
        resize: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
    })),
}));

vi.mock('../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('../../stores/timelineViewStore', () => ({
    timelineViewStore: { value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true } },
    setAutoScroll: vi.fn(),
}));

vi.mock('#/helpers/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

vi.mock('./TimelineContextMenus', () => ({
    ClipContextMenu: ({ onClose }: any) => <div data-testid="clip-menu"><button onClick={onClose}>Close</button></div>,
    TimelineEmptyMenu: ({ onClose }: any) => <div data-testid="empty-menu"><button onClick={onClose}>Close</button></div>,
}));

vi.mock('../hooks/useTimelineInteractions', () => ({
    useTimelineInteractions: vi.fn(() => ({
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
        isImporting: false,
        rubberBand: null,
        contextMenu: null,
        setContextMenu: vi.fn(),
    })),
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: { value: {} },
}));

vi.mock('#/modules/Collaboration/presentations/views/PresenceOverlay', () => ({
    PresenceOverlay: () => <div data-testid="presence-overlay">Presence</div>,
}));

vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: {},
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: {},
}));

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {},
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { isPlaying: false } },
}));

vi.mock('#/modules/Transport/stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));

vi.mock('#/modules/Transport/stores/tempoMapStore', () => ({
    tempoMapStore: {},
}));

vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {},
}));

vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: {},
}));

vi.mock('#/modules/Workspace/useCases/togglePanel/zoomOperations', () => ({
    onZoomToFit: vi.fn(() => vi.fn()),
    onZoomToSelection: vi.fn(() => vi.fn()),
    onScrollToPlayhead: vi.fn(() => vi.fn()),
}));

describe('TimelineSurface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<TimelineSurface />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = render(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct aria attributes on canvas', () => {
        const { container } = render(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('aria-label', 'Timeline editor surface');
    });

    it('should render PresenceOverlay', () => {
        render(<TimelineSurface />);
        expect(screen.getByTestId('presence-overlay')).toBeInTheDocument();
    });

    it('should handle drag over state', () => {
        const { useTimelineInteractions } = vi.importMock('../hooks/useTimelineInteractions');
        useTimelineInteractions.mockReturnValue({
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
        
        render(<TimelineSurface />);
        expect(screen.getByText('Drop audio or MIDI files here')).toBeInTheDocument();
    });

    it('should handle importing state', () => {
        const { useTimelineInteractions } = vi.importMock('../hooks/useTimelineInteractions');
        useTimelineInteractions.mockReturnValue({
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
        
        render(<TimelineSurface />);
        expect(screen.getByText('Importing audio…')).toBeInTheDocument();
    });

    it('should have relative flex container', () => {
        const { container } = render(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('relative');
        expect(container.firstChild).toHaveClass('flex-1');
    });

    it('should have overflow hidden', () => {
        const { container } = render(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('overflow-hidden');
    });
});

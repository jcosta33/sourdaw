import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    addAutomationPoint,
    removeAutomationPoint,
    insertAutomationShape,
    deleteSelectedPoints,
    adjustYZoom,
    zoomToUsedRange,
    toggleAutomationVisibility,
    removeAutomationLane,
    restoreAutomationLanes,
} from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { type AutomationLane, type AutomationPoint } from '../../../../models/AutomationViewTypes';
import { onDrawMouseDown, onRubberBandStart, applyCurveSelect } from '../../../helpers/automationDrag';
import { AutomationLaneRow } from '../AutomationLaneRow';

const { mockWorkspaceStoreRef, mockTransportStoreRef, mockWorkspaceState, mockTransportState } = vi.hoisted(() => ({
    mockWorkspaceStoreRef: {},
    mockTransportStoreRef: {},
    mockWorkspaceState: { activeTool: 'pointer', snapValue: 1 },
    mockTransportState: { playheadPosition: 0 },
}));

vi.mock('#/utils/Styles/cn', () => ({
    cn: (...inputs: (string | undefined | null | false | Record<string, boolean>)[]) => {
        const classes: string[] = [];
        for (const input of inputs) {
            if (typeof input === 'string') {
                classes.push(input);
            } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
                for (const [key, value] of Object.entries(input)) {
                    if (value) {
                        classes.push(key);
                    }
                }
            }
        }
        return classes.join(' ');
    },
}));

vi.mock('../AutomationLaneHeader', () => ({
    AutomationLaneHeader: (props: { currentValue: number | null }) => (
        <div data-testid="lane-header" data-current-value={String(props.currentValue)}>
            Header
        </div>
    ),
}));

vi.mock('../AutomationLaneControls', () => ({
    AutomationLaneControls: (props: {
        onZoomToUsedRange: () => void;
        onToggleVisibility: () => void;
        onClose: () => void;
    }) => (
        <div data-testid="lane-controls">
            <button onClick={props.onZoomToUsedRange}>zoom-used-range</button>
            <button onClick={props.onToggleVisibility}>toggle-visibility</button>
            <button onClick={props.onClose}>close-lane</button>
        </div>
    ),
}));

vi.mock('../AutomationContextMenu', () => ({
    AutomationContextMenu: (props: {
        beat: number;
        section: 'curve' | 'shape' | null;
        onCurveSelect: (curve: string) => void;
        onShapeInsert: (shape: string) => void;
        onClose: () => void;
    }) => (
        <div data-testid="context-menu" data-beat={props.beat} data-section={String(props.section)}>
            <button onClick={() => props.onCurveSelect('exponential')}>select-curve</button>
            <button onClick={() => props.onShapeInsert('sine')}>insert-shape</button>
            <button onClick={props.onClose}>close-menu</button>
        </div>
    ),
}));

vi.mock('../../../helpers/automationViewHelpers', () => ({
    LANE_HEIGHT: 120,
    buildCurvePath: vi.fn(() => ''),
}));

vi.mock('../../../helpers/automationLaneConstants', () => ({
    formatParameterValue: vi.fn((value: number) => `${value.toFixed(2)}`),
    curveLabel: vi.fn((curve: string) => curve),
}));

vi.mock('../../../helpers/automationDrag', () => ({
    onDrawMouseDown: vi.fn(),
    onRubberBandStart: vi.fn(),
    onTensionMouseDown: vi.fn(),
    onPointMouseDown: vi.fn(),
    applyCurveSelect: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: unknown) => (store === mockWorkspaceStoreRef ? mockWorkspaceState : mockTransportState)),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: mockTransportStoreRef,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: mockWorkspaceStoreRef,
    defaultWorkspaceState: { activeTool: 'pointer', snapValue: 1 },
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    interpolateAutomationValue: vi.fn(() => 0.5),
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    addAutomationPoint: vi.fn(),
    removeAutomationPoint: vi.fn(),
    toggleAutomationVisibility: vi.fn(),
    removeAutomationLane: vi.fn(),
    restoreAutomationLanes: vi.fn(),
    insertAutomationShape: vi.fn(),
    deleteSelectedPoints: vi.fn(),
    adjustYZoom: vi.fn(),
    zoomToUsedRange: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    pushUndoEntry: vi.fn(),
}));

describe('AutomationLaneRow', () => {
    const defaultProps = {
        lane: {
            id: 'lane-1',
            trackId: 'track-1',
            parameterId: 'volume',
            parameterName: 'Volume',
            minValue: 0,
            maxValue: 1,
            points: [] as AutomationPoint[],
            objects: [] as AutomationLane['objects'],
            visible: true,
            enabled: true,
            collapsed: false,
        },
        trackColor: '#ff0000',
        pixelsPerBeat: 12,
        scrollX: 0,
        containerWidth: 800,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockWorkspaceState.activeTool = 'pointer';
        mockWorkspaceState.snapValue = 1;
        mockTransportState.playheadPosition = 0;
        playheadPositionRef.current = 0;
    });

    afterEach(() => {
        playheadPositionRef.current = 0;
    });

    it('should render without crashing', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-header')).toBeInTheDocument();
    });

    it('should render lane header', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-header')).toBeInTheDocument();
    });

    it('should render lane controls', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        expect(screen.getByTestId('lane-controls')).toBeInTheDocument();
    });

    it('should render SVG element', () => {
        render(<AutomationLaneRow {...defaultProps} />);
        const svg = document.querySelector('svg');
        expect(svg).toBeInTheDocument();
    });

    it('should apply correct height', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;
        expect(laneDiv).toHaveStyle({ height: '120px' });
    });

    it('should set tabindex for keyboard navigation', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;
        expect(laneDiv).toHaveAttribute('tabIndex', '0');
    });

    it('should wire the lane controls callbacks to the zoom, visibility, and removal use cases', () => {
        render(<AutomationLaneRow {...defaultProps} />);

        fireEvent.click(screen.getByText('zoom-used-range'));
        expect(zoomToUsedRange).toHaveBeenCalledWith('lane-1');

        fireEvent.click(screen.getByText('toggle-visibility'));
        expect(toggleAutomationVisibility).toHaveBeenCalledWith('lane-1');

        // The X removes the lane (DAW convention: close = remove) — it is a
        // distinct action from the eye, which only hides it. Before this fix
        // both buttons called `toggleAutomationVisibility`.
        fireEvent.click(screen.getByText('close-lane'));
        expect(removeAutomationLane).toHaveBeenCalledWith('lane-1');
        expect(toggleAutomationVisibility).toHaveBeenCalledTimes(1);
    });

    it('closing a lane pushes an undo entry whose undo restores the lane with its points', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            points: [
                { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 4, value: 0.6, curve: 'linear', tension: 0 },
            ],
        };
        render(<AutomationLaneRow {...defaultProps} lane={lane} />);

        fireEvent.click(screen.getByText('close-lane'));

        expect(removeAutomationLane).toHaveBeenCalledWith('lane-1');
        expect(pushUndoEntry).toHaveBeenCalledWith(
            'Remove automation lane',
            expect.any(Function),
            expect.any(Function)
        );

        const [, undoFn, redoFn] = vi.mocked(pushUndoEntry).mock.calls[0]!;

        undoFn();
        expect(restoreAutomationLanes).toHaveBeenCalledWith([lane]);

        redoFn();
        expect(removeAutomationLane).toHaveBeenCalledTimes(2);
    });

    it('cancels an in-flight drag when the row unmounts mid-gesture', () => {
        const cancelDrag = vi.fn();
        vi.mocked(onRubberBandStart).mockReturnValue(cancelDrag);

        const { container, unmount } = render(<AutomationLaneRow {...defaultProps} />);
        const svg = container.querySelector('svg')!;
        fireEvent.mouseDown(svg, { button: 0 });

        expect(cancelDrag).not.toHaveBeenCalled();
        unmount();
        expect(cancelDrag).toHaveBeenCalledTimes(1);
    });

    it('does not throw on unmount when no drag was ever started', () => {
        const { unmount } = render(<AutomationLaneRow {...defaultProps} />);
        expect(() => unmount()).not.toThrow();
    });

    it('should render breakpoint nodes only for in-viewport points and show curve labels for non-linear curves', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            points: [
                { beat: 0, value: 0.2, curve: 'exponential', tension: 0 },
                { beat: 8, value: 0.6, curve: 'linear', tension: 0 },
                { beat: 100, value: 0.9, curve: 'linear', tension: 0 },
            ],
        };
        const { container } = render(<AutomationLaneRow {...defaultProps} lane={lane} />);

        expect(container.querySelectorAll('[data-auto-point]')).toHaveLength(2);
        expect(screen.getByText('exponential')).toBeInTheDocument();
        expect(screen.queryByText('linear')).not.toBeInTheDocument();
    });

    it('should surface the interpolated current value at the playhead for before/between/after cases', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            points: [
                { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 8, value: 0.8, curve: 'linear', tension: 0 },
            ],
        };

        // The store is pinned to a beat that would select the "after" branch for
        // every case, so these assertions only hold if the row reads the
        // high-frequency ref instead. Each case remounts: the ref is invisible to
        // React, so a bare rerender would replay the Compiler's memoized output.
        mockTransportState.playheadPosition = 100;

        const cases: { beat: number; expected: string }[] = [
            { beat: -5, expected: '0.2' },
            { beat: 4, expected: '0.5' },
            { beat: 100, expected: '0.8' },
        ];

        for (const testCase of cases) {
            playheadPositionRef.current = testCase.beat;
            const { unmount } = render(<AutomationLaneRow {...defaultProps} lane={lane} />);
            expect(screen.getByTestId('lane-header')).toHaveAttribute('data-current-value', testCase.expected);
            unmount();
        }
    });

    it('should render in-view automation objects with their name and pool icon, filtering out-of-view objects', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            objects: [
                { id: 'obj-1', laneId: 'lane-1', startBeat: 0, endBeat: 8, points: [], name: 'ObjA', poolId: 'pool-1' },
                { id: 'obj-2', laneId: 'lane-1', startBeat: 200, endBeat: 210, points: [], name: 'ObjB' },
            ],
        };
        render(<AutomationLaneRow {...defaultProps} lane={lane} />);

        expect(screen.getByText('🔗 ObjA')).toBeInTheDocument();
        expect(screen.queryByText('ObjB')).not.toBeInTheDocument();
    });

    it('should render a dashed zero baseline only when the value range crosses zero', () => {
        const laneCrossingZero = { ...defaultProps.lane, minValue: -1, maxValue: 1 };
        const { container, rerender } = render(<AutomationLaneRow {...defaultProps} lane={laneCrossingZero} />);
        expect(container.querySelector('line[stroke-dasharray="4 3"]')).toBeInTheDocument();

        const lanePositiveOnly = { ...defaultProps.lane, minValue: 0, maxValue: 1 };
        rerender(<AutomationLaneRow {...defaultProps} lane={lanePositiveOnly} />);
        expect(container.querySelector('line[stroke-dasharray="4 3"]')).not.toBeInTheDocument();
    });

    it('should dispatch draw or rubber-band handlers based on the active tool and ignore secondary buttons', () => {
        const { container, rerender } = render(<AutomationLaneRow {...defaultProps} />);
        const svg = container.querySelector('svg')!;

        fireEvent.mouseDown(svg, { button: 1 });
        expect(onDrawMouseDown).not.toHaveBeenCalled();
        expect(onRubberBandStart).not.toHaveBeenCalled();

        fireEvent.mouseDown(svg, { button: 0 });
        expect(onRubberBandStart).toHaveBeenCalledTimes(1);
        expect(onRubberBandStart).toHaveBeenCalledWith(
            expect.anything(),
            defaultProps.lane,
            expect.any(Function),
            expect.any(Function),
            expect.anything()
        );
        expect(onDrawMouseDown).not.toHaveBeenCalled();

        mockWorkspaceState.activeTool = 'draw';
        rerender(<AutomationLaneRow {...defaultProps} />);
        fireEvent.mouseDown(svg, { button: 0 });
        expect(onDrawMouseDown).toHaveBeenCalledWith(expect.anything(), defaultProps.lane, 1, expect.anything());
    });

    it('should open a shape context menu on right-click and invoke curve/shape selection through it', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const svg = container.querySelector('svg')!;
        svg.getBoundingClientRect = vi.fn(() => ({
            left: 0,
            top: 0,
            right: 800,
            bottom: 120,
            width: 800,
            height: 120,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }));

        fireEvent.contextMenu(svg, { clientX: 120, clientY: 20 });
        const menu = screen.getByTestId('context-menu');
        expect(menu).toHaveAttribute('data-section', 'shape');
        expect(menu).toHaveAttribute('data-beat', '10');

        fireEvent.click(screen.getByText('select-curve'));
        expect(applyCurveSelect).toHaveBeenCalledWith('lane-1', 10, 'exponential');
        expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument();

        fireEvent.contextMenu(svg, { clientX: 120, clientY: 20 });
        fireEvent.click(screen.getByText('insert-shape'));
        expect(insertAutomationShape).toHaveBeenCalledWith('lane-1', 'sine', 10, 14);
    });

    it('should open a point context menu on right-click and remove the point with an undoable entry on double-click', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            points: [{ beat: 8, value: 0.5, curve: 'linear', tension: 0 }],
        };
        const { container } = render(<AutomationLaneRow {...defaultProps} lane={lane} />);

        const pointGroup = container.querySelector('[data-auto-point]')!;
        const captureCircle = pointGroup.querySelector('circle')!;

        fireEvent.contextMenu(captureCircle, { clientX: 5, clientY: 5 });
        const menu = screen.getByTestId('context-menu');
        expect(menu).toHaveAttribute('data-section', 'null');
        expect(menu).toHaveAttribute('data-beat', '8');

        fireEvent.doubleClick(captureCircle);
        expect(removeAutomationPoint).toHaveBeenCalledWith('lane-1', 8);
        expect(pushUndoEntry).toHaveBeenCalledWith(
            'Delete automation point',
            expect.any(Function),
            expect.any(Function)
        );

        const [, undoFn, redoFn] = vi.mocked(pushUndoEntry).mock.calls[0]!;
        undoFn();
        expect(addAutomationPoint).toHaveBeenCalledWith('lane-1', lane.points[0]);
        redoFn();
        expect(removeAutomationPoint).toHaveBeenCalledTimes(2);
    });

    it('should select all points on Ctrl+A and delete them on Delete, doing nothing without a selection', () => {
        const lane: AutomationLane = {
            ...defaultProps.lane,
            points: [
                { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                { beat: 4, value: 0.6, curve: 'linear', tension: 0 },
            ],
        };
        const { container } = render(<AutomationLaneRow {...defaultProps} lane={lane} />);
        const laneDiv = container.firstChild as HTMLElement;

        fireEvent.keyDown(laneDiv, { key: 'Delete' });
        expect(deleteSelectedPoints).not.toHaveBeenCalled();

        fireEvent.keyDown(laneDiv, { key: 'a', ctrlKey: true });
        fireEvent.keyDown(laneDiv, { key: 'Delete' });
        expect(deleteSelectedPoints).toHaveBeenCalledWith('lane-1', [0, 4]);
    });

    it('should adjust Y zoom on alt+wheel and ignore plain wheel scrolling', () => {
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;

        fireEvent.wheel(laneDiv, { deltaY: 10 });
        expect(adjustYZoom).not.toHaveBeenCalled();

        fireEvent.wheel(laneDiv, { deltaY: 10, altKey: true });
        expect(adjustYZoom).toHaveBeenCalledWith('lane-1', -1);

        fireEvent.wheel(laneDiv, { deltaY: -10, altKey: true });
        expect(adjustYZoom).toHaveBeenCalledWith('lane-1', 1);
    });

    it('cancels the browser default when alt+wheel zooms the lane, and not otherwise', () => {
        // Same defect as the piano roll's ctrl+wheel: React registers `wheel`
        // at its root with `{ passive: true }`, so a `preventDefault()` inside
        // a JSX `onWheel` prop cannot stop the browser acting on the same
        // gesture. Plain wheel must stay cancellable so the lane still scrolls.
        const { container } = render(<AutomationLaneRow {...defaultProps} />);
        const laneDiv = container.firstChild as HTMLElement;

        const altEvent = new WheelEvent('wheel', { deltaY: 10, altKey: true, bubbles: true, cancelable: true });
        laneDiv.dispatchEvent(altEvent);
        expect(altEvent.defaultPrevented).toBe(true);
        expect(adjustYZoom).toHaveBeenCalledWith('lane-1', -1);

        const plainEvent = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
        laneDiv.dispatchEvent(plainEvent);
        expect(plainEvent.defaultPrevented).toBe(false);
    });

    it('renders the curve geometry the virgin-territory branch used to produce', () => {
        // Deleting the virgin-territory drawing branch had to be output-identical,
        // not assumed to be. Before the deletion this exact case was rendered
        // twice — flag on and flag off, against the REAL getAutomationRegions
        // rather than the [] stub above — and the two path sets asserted equal.
        // They were equal because that helper's default maxGap is Infinity: it
        // returned exactly one region spanning first point to last, so filtering
        // the visible points by it was a no-op. The snapshot below is the
        // geometry captured from that pre-deletion run, so this pins that the
        // surviving single builder still emits precisely the same thing.
        const points: AutomationPoint[] = [
            { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
            { beat: 4, value: 0.8, curve: 'linear', tension: 0 },
        ];

        const { container } = render(<AutomationLaneRow {...defaultProps} lane={{ ...defaultProps.lane, points }} />);
        const plainPaths = [...container.querySelectorAll('path')].map((node) => node.getAttribute('d'));

        expect(plainPaths.length).toBeGreaterThan(0);
        expect(plainPaths).toMatchInlineSnapshot(`
          [
            "M 0 93.6  L 48 120 L 0 120 Z",
            "M 0 93.6 ",
          ]
        `);
    });
});

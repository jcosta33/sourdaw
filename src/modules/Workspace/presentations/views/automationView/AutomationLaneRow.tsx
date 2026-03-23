import {
    type ReactElement,
    type MouseEvent,
    type WheelEvent,
    type KeyboardEvent,
    useState,
    useRef,
    useSyncExternalStore,
} from 'react';
import { cn } from '#/helpers/Styles/cn';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { type AutomationLane, type AutomationPoint, type AutomationCurveType } from '#/modules/Track/models/Automation';
import {
    addAutomationPoint,
    removeAutomationPoint,
    updateAutomationPoint,
    setAutomationPointCurve,
    toggleAutomationVisibility,
} from '#/modules/Track/useCases/automationUseCases';
import { insertAutomationShape, type AutomationShapeType } from '#/modules/Track/useCases/automationShapes';
import { beginDrawSession, paintDrawPoint, endDrawSession } from '#/modules/Track/useCases/automationDrawMode';
import {
    selectPointsInRange,
    deleteSelectedPoints,
    getSelectionBounds,
} from '#/modules/Track/useCases/automationSelection';
import { adjustYZoom, zoomToUsedRange, toggleVirginTerritory } from '#/modules/Track/useCases/automationZoom';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { LANE_HEIGHT, buildCurvePath } from './automationViewHelpers';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { interpolateAutomationValue, getAutomationRegions } from '#/modules/Track/transformers/automationTransformers';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { Eye, EyeOff, X, Maximize2 } from 'lucide-react';

type AutomationLaneRowProps = {
    lane: AutomationLane;
    trackColor: string;
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

const CURVE_OPTIONS: { value: AutomationCurveType; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 's-curve', label: 'S-Curve (Smooth)' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'step', label: 'Step (Hold)' },
    { value: 'stairs', label: 'Stairs' },
    { value: 'smooth', label: 'Smooth (Spline)' },
];

const SHAPE_OPTIONS: { value: AutomationShapeType; label: string }[] = [
    { value: 'sine', label: '∿ Sine' },
    { value: 'triangle', label: '△ Triangle' },
    { value: 'sawtooth-up', label: '⟋ Sawtooth Up' },
    { value: 'sawtooth-down', label: '⟍ Sawtooth Down' },
    { value: 'square', label: '⊓ Square' },
    { value: 'random', label: '⚡ Random' },
];

export const AutomationLaneRow = ({
    lane,
    trackColor,
    pixelsPerBeat,
    scrollX,
    containerWidth,
}: AutomationLaneRowProps): ReactElement => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [dragPointBeat, setDragPointBeat] = useState<number | null>(null);
    const [hoveredBeat, setHoveredBeat] = useState<number | null>(null);
    const [selectedPoints, setSelectedPoints] = useState<number[]>([]);
    const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const [tensionDrag, setTensionDrag] = useState<{ beat: number; initialTension: number } | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        beat: number;
        section: 'curve' | 'shape' | null;
    } | null>(null);

    const workspace = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(() => cb()),
        () => workspaceStore.value,
        () => workspaceStore.value
    );

    const transport = useSyncExternalStore(
        (cb) => transportStore.subscribe(() => cb()),
        () => transportStore.value,
        () => transportStore.value
    );

    const isDrawMode = workspace?.activeTool === 'draw';
    const curveColor = lane.color ?? trackColor;
    const isDisabled = lane.enabled === false;
    const snapValue = workspace?.snapValue ?? 1;

    const viewportStartBeat = scrollX / pixelsPerBeat;
    const viewportEndBeat = viewportStartBeat + containerWidth / pixelsPerBeat;

    // Per-lane Y-axis zoom support
    const vMin = lane.viewMinValue ?? lane.minValue;
    const vMax = lane.viewMaxValue ?? lane.maxValue;
    const vRange = vMax - vMin;
    const isYZoomed = lane.viewMinValue !== undefined || lane.viewMaxValue !== undefined;

    const beatToX = (beat: number): number => (beat - viewportStartBeat) * pixelsPerBeat;
    const valueToY = (value: number): number => {
        const normalized = vRange !== 0 ? (value - vMin) / vRange : 0;
        return LANE_HEIGHT - normalized * (LANE_HEIGHT - 8) - 4;
    };
    const xToBeat = (x: number): number => x / pixelsPerBeat + viewportStartBeat;
    const yToValue = (y: number): number => {
        const normalized = 1 - (y - 4) / (LANE_HEIGHT - 8);
        return vMin + Math.max(0, Math.min(1, normalized)) * vRange;
    };

    // Virgin territory data
    const vtRegions = lane.virginTerritory ? getAutomationRegions(lane.points) : [];

    // Interpolated value at playhead
    const playheadBeat = transport?.playheadPosition ?? 0;
    let currentValue: number | null = null;
    if (lane.points.length > 0) {
        const before = lane.points.filter((p) => p.beat <= playheadBeat);
        const after = lane.points.filter((p) => p.beat > playheadBeat);
        if (before.length === 0) {
            currentValue = lane.points[0]!.value;
        } else if (after.length === 0) {
            currentValue = before[before.length - 1]!.value;
        } else {
            currentValue = interpolateAutomationValue(before[before.length - 1]!, after[0]!, playheadBeat);
        }
    }

    const formatValue = (v: number): string => {
        if (lane.parameterId === 'gain') {
            if (v <= 0) {
                return '-∞ dB';
            }
            const db = 20 * Math.log10(v);
            return `${db.toFixed(1)} dB`;
        }
        if (lane.parameterId === 'pan') {
            if (Math.abs(v) < 0.01) {
                return 'C';
            }
            return v > 0 ? `${(v * 100).toFixed(0)}R` : `${(-v * 100).toFixed(0)}L`;
        }
        return `${(v * 100).toFixed(0)}%`;
    };

    const visiblePoints = lane.points.filter((p) => p.beat >= viewportStartBeat - 2 && p.beat <= viewportEndBeat + 2);
    const selectedSet = new Set(selectedPoints);

    // Build SVG paths — in VT mode, break into separate segments per region
    const pathSegments: { pathD: string; fillD: string }[] = [];

    if (lane.virginTerritory && vtRegions.length > 0) {
        // Build separate path per region
        for (const region of vtRegions) {
            const regionPoints = visiblePoints.filter((p) => p.beat >= region.startBeat && p.beat <= region.endBeat);
            if (regionPoints.length === 0) {
                continue;
            }
            let segPath = `M ${beatToX(regionPoints[0]!.beat)} ${valueToY(regionPoints[0]!.value)}`;
            for (let i = 0; i < regionPoints.length - 1; i++) {
                const allIdx = lane.points.indexOf(regionPoints[i]!);
                const prevPt = allIdx > 0 ? lane.points[allIdx - 1] : undefined;
                const nextPt = allIdx < lane.points.length - 2 ? lane.points[allIdx + 2] : undefined;
                segPath += ` ${buildCurvePath(regionPoints[i]!, regionPoints[i + 1]!, beatToX, valueToY, prevPt, nextPt)}`;
            }
            const segFill =
                regionPoints.length > 1
                    ? `${segPath} L ${beatToX(regionPoints[regionPoints.length - 1]!.beat)} ${LANE_HEIGHT} L ${beatToX(regionPoints[0]!.beat)} ${LANE_HEIGHT} Z`
                    : '';
            pathSegments.push({ pathD: segPath, fillD: segFill });
        }
    } else if (visiblePoints.length > 0) {
        // Continuous path (non-VT mode)
        let pathD = `M ${beatToX(visiblePoints[0]!.beat)} ${valueToY(visiblePoints[0]!.value)}`;
        for (let i = 0; i < visiblePoints.length - 1; i++) {
            const allIdx = lane.points.indexOf(visiblePoints[i]!);
            const prevPt = allIdx > 0 ? lane.points[allIdx - 1] : undefined;
            const nextPt = allIdx < lane.points.length - 2 ? lane.points[allIdx + 2] : undefined;
            pathD += ` ${buildCurvePath(visiblePoints[i]!, visiblePoints[i + 1]!, beatToX, valueToY, prevPt, nextPt)}`;
        }
        const fillD = `${pathD} L ${beatToX(visiblePoints[visiblePoints.length - 1]!.beat)} ${LANE_HEIGHT} L ${beatToX(visiblePoints[0]!.beat)} ${LANE_HEIGHT} Z`;
        pathSegments.push({ pathD, fillD });
    }

    // Selection bounding box
    const selBounds = selectedPoints.length > 1 ? getSelectionBounds(lane.id, selectedPoints) : null;

    // ─── DRAW MODE HANDLERS ───
    const handleDrawMouseDown = (e: MouseEvent<SVGSVGElement>) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const beat = Math.max(0, xToBeat(x));
        const value = yToValue(y);

        beginDrawSession(lane.id, snapValue, e.shiftKey);
        paintDrawPoint(beat, value);

        const onMove = (me: globalThis.MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            paintDrawPoint(Math.max(0, xToBeat(mx)), yToValue(my));
        };
        const onUp = () => {
            endDrawSession();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // ─── RUBBER-BAND SELECTION HANDLERS ───
    const handleRubberBandStart = (e: MouseEvent<SVGSVGElement>) => {
        if (
            (e.target as Element).closest('[data-auto-point]') ||
            (e.target as Element).closest('[data-tension-handle]')
        ) {
            return;
        }
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (!e.shiftKey) {
            setSelectedPoints([]);
        }

        setRubberBand({ x1: x, y1: y, x2: x, y2: y });

        const onMove = (me: globalThis.MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            setRubberBand((prev) => (prev ? { ...prev, x2: mx, y2: my } : null));
        };

        const onUp = (me: globalThis.MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            const b1 = xToBeat(Math.min(x, mx));
            const b2 = xToBeat(Math.max(x, mx));
            const v1 = yToValue(Math.max(y, my));
            const v2 = yToValue(Math.min(y, my));

            if (Math.abs(mx - x) > 4 || Math.abs(my - y) > 4) {
                const found = selectPointsInRange(lane.id, b1, b2, v1, v2);
                if (e.shiftKey) {
                    setSelectedPoints((prev) => {
                        const set = new Set(prev);
                        for (const beat of found) {
                            if (set.has(beat)) {
                                set.delete(beat);
                            } else {
                                set.add(beat);
                            }
                        }
                        return [...set];
                    });
                } else {
                    setSelectedPoints(found);
                }
            } else if (!e.shiftKey) {
                // Single click in empty space — just add a point in normal mode
                const beat = Math.max(0, xToBeat(x));
                const value = yToValue(y);
                const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
                addAutomationPoint(lane.id, point);
                pushUndoEntry(
                    'Add automation point',
                    () => removeAutomationPoint(lane.id, beat),
                    () => addAutomationPoint(lane.id, point)
                );
            }

            setRubberBand(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // ─── SVG CLICK/MOUSEDOWN DISPATCHER ───
    const handleSvgMouseDown = (e: MouseEvent<SVGSVGElement>) => {
        if (e.button !== 0) {
            return;
        }
        if (isDrawMode) {
            handleDrawMouseDown(e);
        } else {
            handleRubberBandStart(e);
        }
    };

    // ─── TENSION HANDLE DRAG ───
    const handleTensionMouseDown = (pointBeat: number, e: MouseEvent<SVGCircleElement>) => {
        e.stopPropagation();
        const point = lane.points.find((p) => p.beat === pointBeat);
        if (!point) {
            return;
        }
        const initialTension = point.tension ?? 0;
        setTensionDrag({ beat: pointBeat, initialTension });

        const startY = e.clientY;

        const onMove = (me: globalThis.MouseEvent) => {
            const dy = me.clientY - startY;
            const newTension = Math.max(-1, Math.min(1, initialTension + dy / 100));
            setAutomationPointCurve(lane.id, pointBeat, point.curve, newTension);
        };

        const onUp = () => {
            setTensionDrag(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    // ─── BREAKPOINT HANDLERS ───
    const handlePointMouseDown = (pointBeat: number, e: MouseEvent<SVGCircleElement>) => {
        e.stopPropagation();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }

        // Toggle selection with Shift
        if (e.shiftKey) {
            setSelectedPoints((prev) =>
                prev.includes(pointBeat) ? prev.filter((b) => b !== pointBeat) : [...prev, pointBeat]
            );
            return;
        }

        const origPoint = lane.points.find((p) => p.beat === pointBeat);
        if (!origPoint) {
            return;
        }
        const origBeat = origPoint.beat;
        const origValue = origPoint.value;
        let currentBeat = pointBeat;
        setDragPointBeat(pointBeat);

        const onMove = (me: globalThis.MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            let newBeat = Math.max(0, xToBeat(mx));
            let newValue = yToValue(my);
            // Shift constrains to axis
            if (me.shiftKey) {
                const dx = Math.abs(newBeat - origBeat);
                const dy = Math.abs(newValue - origValue);
                if (dx > dy) {
                    newValue = origValue;
                } else {
                    newBeat = origBeat;
                }
            }
            updateAutomationPoint(lane.id, currentBeat, newValue, newBeat);
            currentBeat = newBeat;
            setDragPointBeat(newBeat);
        };

        const onUp = () => {
            setDragPointBeat(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalState = automationStore.value;
            const finalLane = finalState?.lanes.find((l) => l.id === lane.id);
            const finalPoint = finalLane?.points.find((p) => Math.abs(p.beat - currentBeat) < 0.05);
            if (finalPoint && (finalPoint.beat !== origBeat || finalPoint.value !== origValue)) {
                const fb = finalPoint.beat;
                const fv = finalPoint.value;
                pushUndoEntry(
                    'Move automation point',
                    () => updateAutomationPoint(lane.id, fb, origValue, origBeat),
                    () => updateAutomationPoint(lane.id, origBeat, fv, fb)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handlePointDoubleClick = (pointBeat: number, e: MouseEvent<SVGCircleElement>) => {
        e.stopPropagation();
        const point = lane.points.find((p) => p.beat === pointBeat);
        if (!point) {
            return;
        }
        const savedPoint = { ...point };
        removeAutomationPoint(lane.id, pointBeat);
        pushUndoEntry(
            'Delete automation point',
            () => addAutomationPoint(lane.id, savedPoint),
            () => removeAutomationPoint(lane.id, pointBeat)
        );
        setSelectedPoints((prev) => prev.filter((b) => b !== pointBeat));
    };

    const handlePointContextMenu = (pointBeat: number, e: MouseEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, beat: pointBeat, section: null });
    };

    const handleSvgContextMenu = (e: MouseEvent<SVGSVGElement>) => {
        if ((e.target as Element).closest('[data-auto-point]')) {
            return;
        }
        e.preventDefault();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const beat = Math.max(0, xToBeat(x));
        setContextMenu({ x: e.clientX, y: e.clientY, beat, section: 'shape' });
    };

    const handleCurveSelect = (curve: AutomationCurveType) => {
        if (!contextMenu) {
            return;
        }
        setAutomationPointCurve(lane.id, contextMenu.beat, curve, 0.5);
        setContextMenu(null);
    };

    const handleShapeInsert = (shape: AutomationShapeType) => {
        if (!contextMenu) {
            return;
        }
        insertAutomationShape(lane.id, shape, contextMenu.beat, contextMenu.beat + 4);
        setContextMenu(null);
    };

    // ─── KEYBOARD FOR SELECTION ───
    const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPoints.length > 0) {
            event.preventDefault();
            deleteSelectedPoints(lane.id, selectedPoints);
            setSelectedPoints([]);
        }
        if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            setSelectedPoints(lane.points.map((p) => p.beat));
        }
        if (event.key === 'Escape') {
            setSelectedPoints([]);
        }
    };

    // ─── Y-AXIS ZOOM VIA WHEEL ───
    const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
        if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY > 0 ? -1 : 1; // scroll up = zoom in
            adjustYZoom(lane.id, delta);
        }
    };

    const showZeroLine = vMin < 0 && vMax > 0;

    // ─── Tension handle positions (midpoint of each segment) ───
    const tensionHandles: { cx: number; cy: number; beat: number; tension: number }[] = [];
    for (let i = 0; i < visiblePoints.length - 1; i++) {
        const p1 = visiblePoints[i]!;
        const p2 = visiblePoints[i + 1]!;
        if (p1.curve === 'step' || p1.curve === 'linear') {
            continue;
        }
        const midBeat = (p1.beat + p2.beat) / 2;
        const midValue = (p1.value + p2.value) / 2;
        tensionHandles.push({
            cx: beatToX(midBeat),
            cy: valueToY(midValue),
            beat: p1.beat,
            tension: p1.tension ?? 0,
        });
    }

    return (
        <div
            className={cn('relative border-b border-border/20 outline-none', isDisabled && 'opacity-50')}
            style={{ height: LANE_HEIGHT }}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onWheel={handleWheel}
        >
            {/* Lane header */}
            <div className="absolute top-1 left-2 z-10 flex items-center gap-1.5">
                <div className="size-2 rounded-full" style={{ backgroundColor: curveColor }} />
                <span className="text-[9px] font-medium text-muted-foreground bg-surface-base/90 px-1.5 py-0.5 rounded backdrop-blur-sm">
                    {lane.parameterName}
                </span>
                {currentValue !== null && (
                    <span className="text-[9px] font-mono text-foreground/60 bg-surface-base/80 px-1 py-0.5 rounded">
                        {formatValue(currentValue)}
                    </span>
                )}
                {isDrawMode && (
                    <span className="text-[9px] font-mono text-[var(--color-accent-peach)]/80 bg-[var(--color-accent-peach)]/10 px-1 py-0.5 rounded">
                        DRAW
                    </span>
                )}
                {lane.virginTerritory && (
                    <span className="text-[9px] font-mono text-[var(--color-state-success)]/80 bg-[var(--color-state-success)]/10 px-1 py-0.5 rounded">
                        VT
                    </span>
                )}
                {isYZoomed && (
                    <span className="text-[9px] font-mono text-[var(--color-accent-cyan)]/80 bg-[var(--color-accent-cyan)]/10 px-1 py-0.5 rounded">
                        Y:{(vMin * 100).toFixed(0)}–{(vMax * 100).toFixed(0)}%
                    </span>
                )}
            </div>

            {/* Lane controls */}
            <div className="absolute top-1 right-2 z-10 flex items-center gap-0.5">
                {selectedPoints.length > 0 && (
                    <span className="text-[8px] text-muted-foreground mr-1">{selectedPoints.length} sel</span>
                )}
                <button
                    type="button"
                    className={cn(
                        'size-5 flex items-center justify-center rounded hover:bg-surface-raised/80 transition-colors',
                        lane.virginTerritory ? 'text-[var(--color-state-success)]' : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => toggleVirginTerritory(lane.id)}
                    aria-label={lane.virginTerritory ? 'Disable virgin territory' : 'Enable virgin territory'}
                    title="Virgin Territory"
                >
                    <span className="text-[8px] font-bold">VT</span>
                </button>
                <button
                    type="button"
                    className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
                    onClick={() => zoomToUsedRange(lane.id)}
                    aria-label="Zoom to used range"
                    title="Zoom Y to used range"
                >
                    <Maximize2 className="size-3" />
                </button>
                <button
                    type="button"
                    className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
                    onClick={() => toggleAutomationVisibility(lane.id)}
                    aria-label={lane.visible ? 'Hide lane' : 'Show lane'}
                >
                    {lane.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
                <button
                    type="button"
                    className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded hover:bg-surface-raised/80 transition-colors"
                    onClick={() => toggleAutomationVisibility(lane.id)}
                    aria-label="Close lane"
                >
                    <X className="size-3" />
                </button>
            </div>

            <svg
                ref={svgRef}
                className={cn('w-full h-full', isDrawMode ? 'cursor-cell' : 'cursor-crosshair')}
                onMouseDown={handleSvgMouseDown}
                onContextMenu={handleSvgContextMenu}
                style={{ width: containerWidth }}
            >
                {/* Transparent rect for event capture on empty SVG space */}
                <rect x={0} y={0} width={containerWidth} height={LANE_HEIGHT} fill="transparent" />
                {/* Grid lines */}
                {Array.from({ length: 5 }).map((_, i) => {
                    const y = (LANE_HEIGHT / 4) * i;
                    return (
                        <line
                            key={i}
                            x1={0}
                            y1={y}
                            x2={containerWidth}
                            y2={y}
                            stroke="rgba(255,255,255,0.04)"
                            strokeWidth={1}
                        />
                    );
                })}

                {/* Beat grid */}
                {Array.from({ length: Math.ceil(containerWidth / pixelsPerBeat) + 1 }).map((_, i) => {
                    const beat = Math.floor(viewportStartBeat) + i;
                    const x = beatToX(beat);
                    return (
                        <line
                            key={`beat-${beat}`}
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={LANE_HEIGHT}
                            stroke={beat % 4 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'}
                            strokeWidth={1}
                        />
                    );
                })}

                {showZeroLine && (
                    <line
                        x1={0}
                        y1={valueToY(0)}
                        x2={containerWidth}
                        y2={valueToY(0)}
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                    />
                )}

                {/* Fill under curve segments */}
                {pathSegments.map((seg, i) =>
                    seg.fillD ? (
                        <path key={`fill-${i}`} d={seg.fillD} fill={curveColor} fillOpacity={isDisabled ? 0.04 : 0.1} />
                    ) : null
                )}

                {/* Curve line segments */}
                {pathSegments.map((seg, i) => (
                    <path
                        key={`curve-${i}`}
                        d={seg.pathD}
                        fill="none"
                        stroke={curveColor}
                        strokeOpacity={isDisabled ? 0.3 : 0.8}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={isDisabled ? '4 4' : undefined}
                    />
                ))}

                {/* Automation objects (bounded containers) */}
                {(lane.objects ?? []).map((obj) => {
                    const objX = beatToX(obj.startBeat);
                    const objW = beatToX(obj.endBeat) - objX;
                    if (objX + objW < 0 || objX > containerWidth) {
                        return null;
                    }
                    return (
                        <g key={obj.id}>
                            <rect
                                x={objX}
                                y={2}
                                width={objW}
                                height={LANE_HEIGHT - 4}
                                rx={4}
                                fill={`${curveColor}08`}
                                stroke={curveColor}
                                strokeWidth={1}
                                strokeOpacity={0.4}
                                strokeDasharray={obj.loopLength ? '6 3' : undefined}
                            />
                            <text
                                x={objX + 4}
                                y={14}
                                className="text-[7px] fill-muted-foreground/50 pointer-events-none font-mono"
                            >
                                {obj.poolId ? '🔗 ' : ''}
                                {obj.name}
                            </text>
                        </g>
                    );
                })}

                {/* Tension handles */}
                {tensionHandles.map((th) => {
                    const isActive = tensionDrag?.beat === th.beat;
                    return (
                        <g key={`tension-${th.beat}`} data-tension-handle="true">
                            <circle
                                cx={th.cx}
                                cy={th.cy}
                                r={12}
                                fill="transparent"
                                className="cursor-ns-resize"
                                onMouseDown={(e) => handleTensionMouseDown(th.beat, e)}
                            />
                            <circle
                                cx={th.cx}
                                cy={th.cy}
                                r={isActive ? 5 : 3.5}
                                fill={isActive ? 'white' : 'rgba(255,255,255,0.3)'}
                                stroke={curveColor}
                                strokeWidth={1.5}
                                pointerEvents="none"
                                style={{ filter: isActive ? `drop-shadow(0 0 6px ${curveColor})` : undefined }}
                            />
                            {isActive && (
                                <text
                                    x={th.cx + 10}
                                    y={th.cy + 4}
                                    className="text-[8px] fill-white font-mono"
                                    pointerEvents="none"
                                >
                                    {(th.tension >= 0 ? '+' : '') + th.tension.toFixed(2)}
                                </text>
                            )}
                        </g>
                    );
                })}

                {/* Breakpoint nodes */}
                {visiblePoints.map((point) => {
                    const cx = beatToX(point.beat);
                    const cy = valueToY(point.value);
                    const isDragging = dragPointBeat === point.beat;
                    const isHovered = hoveredBeat === point.beat;
                    const isSelected = selectedSet.has(point.beat);
                    const nodeSize = isDragging ? 6 : isHovered || isSelected ? 5 : 4;

                    return (
                        <g key={`${point.beat}-${point.value}`} data-auto-point="true">
                            <circle
                                cx={cx}
                                cy={cy}
                                r={10}
                                fill="transparent"
                                className="cursor-grab"
                                onMouseDown={(e) => handlePointMouseDown(point.beat, e)}
                                onDoubleClick={(e) => handlePointDoubleClick(point.beat, e)}
                                onContextMenu={(e) => handlePointContextMenu(point.beat, e)}
                                onMouseEnter={() => setHoveredBeat(point.beat)}
                                onMouseLeave={() => setHoveredBeat(null)}
                            />
                            {(isDragging || isHovered || isSelected) && (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={nodeSize + 3}
                                    fill={curveColor}
                                    fillOpacity={0.15}
                                    pointerEvents="none"
                                />
                            )}
                            <circle
                                cx={cx}
                                cy={cy}
                                r={nodeSize}
                                fill={isDragging || isSelected ? 'white' : curveColor}
                                stroke={isSelected ? curveColor : 'white'}
                                strokeWidth={isDragging || isSelected ? 2 : 1.5}
                                pointerEvents="none"
                                style={{
                                    filter: isDragging
                                        ? `drop-shadow(0 0 8px ${curveColor})`
                                        : isHovered || isSelected
                                          ? `drop-shadow(0 0 4px ${curveColor})`
                                          : `drop-shadow(0 0 2px ${curveColor})`,
                                }}
                            />
                            {point.curve !== 'linear' && !isDragging && (
                                <text
                                    x={cx + 8}
                                    y={cy - 8}
                                    className="text-[8px] fill-muted-foreground/60 pointer-events-none font-mono"
                                >
                                    {point.curve === 's-curve'
                                        ? 'S'
                                        : point.curve === 'exponential'
                                          ? 'E'
                                          : point.curve === 'step'
                                            ? '⌐'
                                            : point.curve === 'stairs'
                                              ? '⊏'
                                              : '~'}
                                </text>
                            )}
                            {isHovered && !isDragging && (
                                <g pointerEvents="none">
                                    <rect
                                        x={cx - 24}
                                        y={cy - 22}
                                        width={48}
                                        height={14}
                                        rx={3}
                                        fill="rgba(0,0,0,0.8)"
                                        stroke="rgba(255,255,255,0.2)"
                                        strokeWidth={0.5}
                                    />
                                    <text
                                        x={cx}
                                        y={cy - 12}
                                        textAnchor="middle"
                                        className="text-[8px] fill-white font-mono"
                                    >
                                        {formatValue(point.value)}
                                    </text>
                                </g>
                            )}
                        </g>
                    );
                })}

                {/* Rubber-band selection rectangle */}
                {rubberBand && Math.abs(rubberBand.x2 - rubberBand.x1) > 3 && (
                    <rect
                        x={Math.min(rubberBand.x1, rubberBand.x2)}
                        y={Math.min(rubberBand.y1, rubberBand.y2)}
                        width={Math.abs(rubberBand.x2 - rubberBand.x1)}
                        height={Math.abs(rubberBand.y2 - rubberBand.y1)}
                        fill={`${curveColor}15`}
                        stroke={curveColor}
                        strokeWidth={1}
                        strokeDasharray="3 2"
                        pointerEvents="none"
                    />
                )}

                {/* Selection stretch handles */}
                {selBounds && selectedPoints.length > 1 && !rubberBand && (
                    <g pointerEvents="none">
                        <rect
                            x={beatToX(selBounds.minBeat) - 2}
                            y={valueToY(selBounds.maxValue) - 2}
                            width={beatToX(selBounds.maxBeat) - beatToX(selBounds.minBeat) + 4}
                            height={valueToY(selBounds.minValue) - valueToY(selBounds.maxValue) + 4}
                            fill="none"
                            stroke={curveColor}
                            strokeWidth={1}
                            strokeDasharray="4 2"
                            strokeOpacity={0.5}
                        />
                        {/* Corner handles */}
                        {[
                            { x: beatToX(selBounds.minBeat), y: valueToY(selBounds.maxValue) },
                            { x: beatToX(selBounds.maxBeat), y: valueToY(selBounds.maxValue) },
                            { x: beatToX(selBounds.minBeat), y: valueToY(selBounds.minValue) },
                            { x: beatToX(selBounds.maxBeat), y: valueToY(selBounds.minValue) },
                        ].map((h, i) => (
                            <rect
                                key={`handle-${i}`}
                                x={h.x - 3}
                                y={h.y - 3}
                                width={6}
                                height={6}
                                fill="white"
                                stroke={curveColor}
                                strokeWidth={1}
                            />
                        ))}
                    </g>
                )}
            </svg>

            {/* Context menu */}
            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
                    <div
                        className="fixed z-50 bg-popover border border-border rounded-md shadow-xl py-1 min-w-[160px]"
                        style={{
                            left: contextMenu.x,
                            ...(contextMenu.y > window.innerHeight - 300
                                ? { bottom: window.innerHeight - contextMenu.y }
                                : { top: contextMenu.y }),
                        }}
                    >
                        {contextMenu.section !== 'shape' && (
                            <>
                                <div className="px-2 py-1 text-[9px] text-muted-foreground uppercase tracking-wider">
                                    Curve Type
                                </div>
                                {CURVE_OPTIONS.map((opt) => (
                                    <button
                                        type="button"
                                        key={opt.value}
                                        className={cn(
                                            'w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors',
                                            lane.points.find((p) => Math.abs(p.beat - contextMenu.beat) < 0.05)
                                                ?.curve === opt.value && 'text-primary font-medium'
                                        )}
                                        onClick={() => handleCurveSelect(opt.value)}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                                <div className="mx-2 my-1 border-t border-border/30" />
                            </>
                        )}
                        <div className="px-2 py-1 text-[9px] text-muted-foreground uppercase tracking-wider">
                            Insert Shape
                        </div>
                        {SHAPE_OPTIONS.map((opt) => (
                            <button
                                type="button"
                                key={opt.value}
                                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors"
                                onClick={() => handleShapeInsert(opt.value)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

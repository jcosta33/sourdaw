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
import {
    type AutomationLane,
    type AutomationCurveType,
} from '#/modules/Arrangement/useCases/trackQueries';
import {
    addAutomationPoint,
    removeAutomationPoint,
    toggleAutomationVisibility,
} from '#/modules/Automation/useCases/automation';
import { insertAutomationShape, type AutomationShapeType } from '#/modules/Automation/useCases/automationShapes';
import { deleteSelectedPoints, getSelectionBounds } from '#/modules/Automation/useCases/automationSelection';
import { adjustYZoom, zoomToUsedRange, toggleVirginTerritory } from '#/modules/Automation/useCases/automationZoom';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
import { LANE_HEIGHT, buildCurvePath } from '../../helpers/automationViewHelpers';
import { formatParameterValue, curveLabel } from '../../helpers/automationLaneConstants';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { interpolateAutomationValue, getAutomationRegions } from '#/modules/Arrangement/useCases/automationQueries';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { AutomationLaneHeader } from './AutomationLaneHeader';
import { AutomationLaneControls } from './AutomationLaneControls';
import { AutomationContextMenu } from './AutomationContextMenu';
import {
    onDrawMouseDown,
    onRubberBandStart,
    onTensionMouseDown,
    onPointMouseDown,
    applyCurveSelect,
} from '../../helpers/automationDrag';

type AutomationLaneRowProps = {
    lane: AutomationLane;
    trackColor: string;
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

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

    const getRect = (): DOMRect | undefined => svgRef.current?.getBoundingClientRect();
    const coords = { getRect, xToBeat, yToValue };

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

    const visiblePoints = lane.points.filter((p) => p.beat >= viewportStartBeat - 2 && p.beat <= viewportEndBeat + 2);
    const selectedSet = new Set(selectedPoints);

    // Build SVG paths — in VT mode, break into separate segments per region
    const pathSegments: { pathD: string; fillD: string }[] = [];

    if (lane.virginTerritory && vtRegions.length > 0) {
        for (const region of vtRegions) {
            const regionPoints = visiblePoints.filter(
                (p) => p.beat >= region.startBeat && p.beat <= region.endBeat
            );
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

    // ── SVG dispatcher ───────────────────────────────────────────────────────
    const handleSvgMouseDown = (e: MouseEvent<SVGSVGElement>) => {
        if (e.button !== 0) {
            return;
        }
        if (isDrawMode) {
            onDrawMouseDown(e, lane, snapValue, coords);
        } else {
            onRubberBandStart(e, lane, setRubberBand, setSelectedPoints, coords);
        }
    };

    const handleSvgContextMenu = (e: MouseEvent<SVGSVGElement>) => {
        if ((e.target as Element).closest('[data-auto-point]')) {
            return;
        }
        e.preventDefault();
        const rect = getRect();
        if (!rect) {
            return;
        }
        const beat = Math.max(0, xToBeat(e.clientX - rect.left));
        setContextMenu({ x: e.clientX, y: e.clientY, beat, section: 'shape' });
    };

    const handlePointContextMenu = (pointBeat: number, e: MouseEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, beat: pointBeat, section: null });
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
            () => {
                addAutomationPoint(lane.id, savedPoint);
            },
            () => {
                removeAutomationPoint(lane.id, pointBeat);
            }
        );
        setSelectedPoints((prev) => prev.filter((b) => b !== pointBeat));
    };

    const handleCurveSelect = (curve: AutomationCurveType) => {
        if (!contextMenu) {
            return;
        }
        applyCurveSelect(lane.id, contextMenu.beat, curve);
        setContextMenu(null);
    };

    const handleShapeInsert = (shape: AutomationShapeType) => {
        if (!contextMenu) {
            return;
        }
        insertAutomationShape(lane.id, shape, contextMenu.beat, contextMenu.beat + 4);
        setContextMenu(null);
    };

    // ── Keyboard ─────────────────────────────────────────────────────────────
    const handleKeyDown = (event: KeyboardEvent) => {
        const isDelete = event.key === 'Delete' || event.key === 'Backspace';
        if (isDelete && selectedPoints.length > 0) {
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

    // ── Y-axis zoom ───────────────────────────────────────────────────────────
    const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
        if (!e.altKey) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        adjustYZoom(lane.id, e.deltaY > 0 ? -1 : 1);
    };

    const showZeroLine = vMin < 0 && vMax > 0;

    // Tension handle positions (midpoint of each segment)
    const tensionHandles: { cx: number; cy: number; beat: number; tension: number }[] = [];
    for (let i = 0; i < visiblePoints.length - 1; i++) {
        const p1 = visiblePoints[i]!;
        const p2 = visiblePoints[i + 1]!;
        if (p1.curve === 'step' || p1.curve === 'linear') {
            continue;
        }
        tensionHandles.push({
            cx: beatToX((p1.beat + p2.beat) / 2),
            cy: valueToY((p1.value + p2.value) / 2),
            beat: p1.beat,
            tension: p1.tension ?? 0,
        });
    }

    return (
        <div
            className={cn('relative border-b border-border/20 outline-none', isDisabled ? 'opacity-50' : '')}
            style={{ height: LANE_HEIGHT }}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onWheel={handleWheel}
        >
            <AutomationLaneHeader
                parameterName={lane.parameterName}
                parameterId={lane.parameterId}
                curveColor={curveColor}
                currentValue={currentValue}
                isDrawMode={isDrawMode}
                isVirginTerritory={Boolean(lane.virginTerritory)}
                isYZoomed={isYZoomed}
                viewMin={vMin}
                viewMax={vMax}
            />

            <AutomationLaneControls
                laneId={lane.id}
                isVirginTerritory={Boolean(lane.virginTerritory)}
                isVisible={lane.visible}
                selectedCount={selectedPoints.length}
                onToggleVirginTerritory={() => toggleVirginTerritory(lane.id)}
                onZoomToUsedRange={() => zoomToUsedRange(lane.id)}
                onToggleVisibility={() => toggleAutomationVisibility(lane.id)}
                onClose={() => toggleAutomationVisibility(lane.id)}
            />

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

                {showZeroLine ? (
                    <line
                        x1={0}
                        y1={valueToY(0)}
                        x2={containerWidth}
                        y2={valueToY(0)}
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth={1}
                        strokeDasharray="4 3"
                    />
                ) : null}

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
                                onMouseDown={(e) => onTensionMouseDown(th.beat, e, lane, setTensionDrag)}
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
                            {isActive ? (
                                <text
                                    x={th.cx + 10}
                                    y={th.cy + 4}
                                    className="text-[8px] fill-white font-mono"
                                    pointerEvents="none"
                                >
                                    {(th.tension >= 0 ? '+' : '') + th.tension.toFixed(2)}
                                </text>
                            ) : null}
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
                                onMouseDown={(e) =>
                                    onPointMouseDown(point.beat, e, lane, setDragPointBeat, setSelectedPoints, coords)
                                }
                                onDoubleClick={(e) => handlePointDoubleClick(point.beat, e)}
                                onContextMenu={(e) => handlePointContextMenu(point.beat, e)}
                                onMouseEnter={() => setHoveredBeat(point.beat)}
                                onMouseLeave={() => setHoveredBeat(null)}
                            />
                            {isDragging || isHovered || isSelected ? (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={nodeSize + 3}
                                    fill={curveColor}
                                    fillOpacity={0.15}
                                    pointerEvents="none"
                                />
                            ) : null}
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
                            {point.curve !== 'linear' && !isDragging ? (
                                <text
                                    x={cx + 8}
                                    y={cy - 8}
                                    className="text-[8px] fill-muted-foreground/60 pointer-events-none font-mono"
                                >
                                    {curveLabel(point.curve)}
                                </text>
                            ) : null}
                            {isHovered && !isDragging ? (
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
                                        {formatParameterValue(point.value, lane.parameterId)}
                                    </text>
                                </g>
                            ) : null}
                        </g>
                    );
                })}

                {/* Rubber-band selection rectangle */}
                {rubberBand !== null && Math.abs(rubberBand.x2 - rubberBand.x1) > 3 ? (
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
                ) : null}

                {/* Selection stretch handles */}
                {selBounds !== null && selectedPoints.length > 1 && rubberBand === null ? (
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
                ) : null}
            </svg>

            {contextMenu !== null ? (
                <AutomationContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    beat={contextMenu.beat}
                    section={contextMenu.section}
                    points={lane.points}
                    onCurveSelect={handleCurveSelect}
                    onShapeInsert={handleShapeInsert}
                    onClose={() => setContextMenu(null)}
                />
            ) : null}
        </div>
    );
};

import { type ReactElement, type MouseEvent, type KeyboardEvent, useState, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';
import { interpolateAutomationValue } from '#/modules/Arrangement/useCases';
import {
    addAutomationPoint,
    removeAutomationPoint,
    toggleAutomationVisibility,
    removeAutomationLane,
    restoreAutomationLanes,
    insertAutomationShape,
    deleteSelectedPoints,
    getSelectionBounds,
    adjustYZoom,
    zoomToUsedRange,
} from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore, type WorkspaceState } from '#/modules/WorkspaceShell/stores';
import { cn } from '#/utils/Styles/cn';

import { type AutomationLane, type AutomationCurveType } from '../../../models/AutomationViewTypes';
import {
    onDrawMouseDown,
    onRubberBandStart,
    onTensionMouseDown,
    onPointMouseDown,
    applyCurveSelect,
} from '../../helpers/automationDrag';
import { formatParameterValue, curveLabel } from '../../helpers/automationLaneConstants';
import { LANE_HEIGHT, buildCurvePath } from '../../helpers/automationViewHelpers';

import { AutomationContextMenu } from './AutomationContextMenu';
import { AutomationLaneControls } from './AutomationLaneControls';
import { AutomationLaneHeader } from './AutomationLaneHeader';

type AutomationLaneRowProps = {
    lane: AutomationLane;
    trackColor: string;
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

type AutomationLaneTransportState = {
    playheadPosition: number;
    isPlaying: boolean;
};

const READOUT_INTERVAL_MS = 1000 / 60;

/**
 * Automation value at `beat`, or null when the lane has no points.
 *
 * Single pass, no intermediate arrays: this runs once per lane per animation
 * frame, so the two `filter` calls it replaces were allocating two arrays per
 * lane per frame. Scanning in array order picks the same two points the
 * filters did, for sorted and unsorted point lists alike.
 */
const valueAtBeat = (points: AutomationLane['points'], beat: number): number | null => {
    if (points.length === 0) {
        return null;
    }

    let lastBefore: AutomationLane['points'][number] | undefined;
    let firstAfter: AutomationLane['points'][number] | undefined;
    for (const point of points) {
        if (point.beat <= beat) {
            lastBefore = point;
            continue;
        }
        if (firstAfter === undefined) {
            firstAfter = point;
        }
    }

    if (lastBefore === undefined) {
        return points[0]!.value;
    }
    if (firstAfter === undefined) {
        return lastBefore.value;
    }
    return interpolateAutomationValue(lastBefore, firstAfter, beat);
};

export const AutomationLaneRow = ({
    lane,
    trackColor,
    pixelsPerBeat,
    scrollX,
    containerWidth,
}: AutomationLaneRowProps): ReactElement => {
    const svgRef = useRef<SVGSVGElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const currentValueRef = useRef<HTMLSpanElement>(null);
    // Cancel handle for whatever `automationDrag` gesture is currently live (at
    // most one at a time — the mouse can only drag one thing). Only mouseup or
    // Escape normally tear a gesture's listeners down; this lets the unmount
    // effect below do the same when the row disappears mid-drag (e.g. the lane
    // is removed while one of its points is being dragged).
    const activeDragCancelRef = useRef<(() => void) | null>(null);
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

    const workspace = useStore<WorkspaceState>(workspaceStore, defaultWorkspaceState);

    const transport = useStore<AutomationLaneTransportState>(transportStore, defaultTransportState);

    const isDrawMode = workspace.activeTool === 'draw';
    const curveColor = lane.color ?? trackColor ?? '#a78bfa';
    const isDisabled = lane.enabled === false;
    const snapValue = workspace.snapValue ?? 1;

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

    // Value at the playhead, for the header readout.
    //
    // The clock is `playheadPositionRef`, NOT `transportStore.playheadPosition`.
    // The store is written on exactly four events — start, stop, pause, seek —
    // and notably NOT on loop wrap, so a readout driven by it freezes at the beat
    // playback started from while the audible automation sweeps on. The ref is the
    // ~100 Hz channel the scheduler writes, so it matches what the user hears.
    //
    // This render-time read seeds the first paint only. The ref is invisible to
    // React (and to the Compiler's memoization), so the effect below owns every
    // subsequent update.
    const currentValue = valueAtBeat(lane.points, playheadPositionRef.current);

    // Writes the readout text directly: re-rendering the lane to move a two-glyph
    // badge would repaint the whole SVG curve at frame rate.
    useEffect(() => {
        const paintOnce = (): void => {
            const element = currentValueRef.current;
            if (!element) {
                return;
            }
            const value = valueAtBeat(lane.points, playheadPositionRef.current);
            if (value === null) {
                return;
            }
            const text = formatParameterValue(value, lane.parameterId);
            if (element.textContent !== text) {
                element.textContent = text;
            }
        };

        // Discrete moves (start, stop, pause, seek) re-run this effect; repaint for them.
        paintOnce();

        if (!transport.isPlaying) {
            return undefined;
        }

        // Throttled to the same 60 Hz as `PlayheadDisplay`: rAF fires at the
        // display's refresh rate, and this runs once per visible lane.
        let rafId = 0;
        let lastPaintedAt: number | null = null;
        const loop = (frameTimestamp: number): void => {
            if (lastPaintedAt === null) {
                paintOnce();
                lastPaintedAt = frameTimestamp;
            } else {
                const elapsed = frameTimestamp - lastPaintedAt;
                if (elapsed >= READOUT_INTERVAL_MS) {
                    paintOnce();
                    lastPaintedAt = frameTimestamp - (elapsed % READOUT_INTERVAL_MS);
                }
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [transport.isPlaying, transport.playheadPosition, lane.points, lane.parameterId]);

    const visiblePoints = lane.points.filter(
        (param) => param.beat >= viewportStartBeat - 2 && param.beat <= viewportEndBeat + 2
    );
    const selectedSet = new Set(selectedPoints);

    // Build the SVG curve path.
    //
    // This used to be two branches, one per virginTerritory state, and they
    // were provably identical for any lane with two or more visible points
    // — `getAutomationRegions`' default `maxGap` is Infinity, so it always
    // returned exactly one region spanning first point to last, and filtering
    // the visible points by that region is a no-op. The flag is gone; this is
    // the surviving single builder.
    //
    // The `length > 1` fill guard is kept from the virgin-territory branch,
    // which is the branch nearly every lane took since the flag defaulted to
    // true. A single visible point therefore gets no fill, rather than the
    // zero-width degenerate fill the other branch emitted — which painted
    // nothing regardless.
    const pathSegments: { pathD: string; fillD: string }[] = [];

    if (visiblePoints.length > 0) {
        const pointIndexByRef = new Map(lane.points.map((param, idx) => [param, idx]));
        let pathD = `M ${beatToX(visiblePoints[0]!.beat)} ${valueToY(visiblePoints[0]!.value)}`;
        for (let index = 0; index < visiblePoints.length - 1; index++) {
            const allIdx = pointIndexByRef.get(visiblePoints[index]!) ?? -1;
            const prevPt = allIdx > 0 ? lane.points[allIdx - 1] : undefined;
            const nextPt = allIdx < lane.points.length - 1 ? lane.points[allIdx + 1] : undefined;
            pathD += ` ${buildCurvePath(visiblePoints[index]!, visiblePoints[index + 1]!, beatToX, valueToY, prevPt, nextPt)}`;
        }
        const fillD =
            visiblePoints.length > 1
                ? `${pathD} L ${beatToX(visiblePoints[visiblePoints.length - 1]!.beat)} ${LANE_HEIGHT} L ${beatToX(visiblePoints[0]!.beat)} ${LANE_HEIGHT} Z`
                : '';
        pathSegments.push({ pathD, fillD });
    }

    // Selection bounding box
    const selBounds = selectedPoints.length > 1 ? getSelectionBounds(lane.id, selectedPoints) : null;

    // ── SVG dispatcher ───────────────────────────────────────────────────────
    const handleSvgMouseDown = (event: MouseEvent<SVGSVGElement>) => {
        if (event.button !== 0) {
            return;
        }
        if (isDrawMode) {
            activeDragCancelRef.current = onDrawMouseDown(event, lane, snapValue, coords);
        } else {
            activeDragCancelRef.current = onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords);
        }
    };

    const handleSvgContextMenu = (event: MouseEvent<SVGSVGElement>) => {
        if ((event.target as Element).closest('[data-auto-point]')) {
            return;
        }
        event.preventDefault();
        const rect = getRect();
        if (!rect) {
            return;
        }
        const beat = Math.max(0, xToBeat(event.clientX - rect.left));
        setContextMenu({ x: event.clientX, y: event.clientY, beat, section: 'shape' });
    };

    const handlePointContextMenu = (pointBeat: number, event: MouseEvent<SVGCircleElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY, beat: pointBeat, section: null });
    };

    const handlePointDoubleClick = (pointBeat: number, event: MouseEvent<SVGCircleElement>) => {
        event.stopPropagation();
        const point = lane.points.find((param) => param.beat === pointBeat);
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

    const handleCloseLane = () => {
        const savedLane: AutomationLane = { ...lane, points: [...lane.points] };
        removeAutomationLane(lane.id);
        pushUndoEntry(
            'Remove automation lane',
            () => {
                restoreAutomationLanes([savedLane]);
            },
            () => {
                removeAutomationLane(lane.id);
            }
        );
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
            setSelectedPoints(lane.points.map((param) => param.beat));
        }
        if (event.key === 'Escape') {
            setSelectedPoints([]);
        }
    };

    // Tears down a still-live drag's global listeners if this row unmounts
    // before mouseup or Escape does — otherwise they leak on `window` bound
    // to a closure over props/state from an instance that no longer exists.
    useEffect(() => {
        return () => {
            activeDragCancelRef.current?.();
        };
    }, []);

    // ── Y-axis zoom ───────────────────────────────────────────────────────────
    // Attached imperatively and non-passively: React registers `wheel` at its
    // root container with `{ passive: true }`, so a `preventDefault()` inside a
    // JSX `onWheel` prop cannot stop the browser also acting on the gesture.
    // Only the alt branch cancels; a plain wheel still scrolls the lane.
    useEffect(() => {
        const row = rowRef.current;
        if (!row) {
            return undefined;
        }
        const onWheel = (event: globalThis.WheelEvent): void => {
            if (!event.altKey) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            adjustYZoom(lane.id, event.deltaY > 0 ? -1 : 1);
        };
        row.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            row.removeEventListener('wheel', onWheel);
        };
    }, [lane.id]);

    const showZeroLine = vMin < 0 && vMax > 0;

    // Tension handle positions (midpoint of each segment)
    const tensionHandles: { cx: number; cy: number; beat: number; tension: number }[] = [];
    for (let index = 0; index < visiblePoints.length - 1; index++) {
        const p1 = visiblePoints[index]!;
        const p2 = visiblePoints[index + 1]!;
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
            // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- handles keyboard events (arrow key point editing); tabIndex needed for focus
            tabIndex={0}
            onKeyDown={handleKeyDown}
            ref={rowRef}
        >
            <AutomationLaneHeader
                parameterName={lane.parameterName}
                parameterId={lane.parameterId}
                curveColor={curveColor}
                currentValue={currentValue}
                currentValueRef={currentValueRef}
                isDrawMode={isDrawMode}
                isYZoomed={isYZoomed}
                viewMin={vMin}
                viewMax={vMax}
            />
            <AutomationLaneControls
                isVisible={lane.visible}
                selectedCount={selectedPoints.length}
                onZoomToUsedRange={() => zoomToUsedRange(lane.id)}
                onToggleVisibility={() => toggleAutomationVisibility(lane.id)}
                onClose={handleCloseLane}
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
                {Array.from({ length: 5 }).map((_, index) => {
                    const y = (LANE_HEIGHT / 4) * index;
                    return (
                        <line
                            key={index}
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
                {Array.from({ length: Math.ceil(containerWidth / pixelsPerBeat) + 1 }).map((_, index) => {
                    const beat = Math.floor(viewportStartBeat) + index;
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
                {pathSegments.map((seg, index) =>
                    seg.fillD ? (
                        <path
                            key={`fill-${index}`}
                            d={seg.fillD}
                            fill={curveColor}
                            fillOpacity={isDisabled ? 0.04 : 0.1}
                        />
                    ) : null
                )}

                {/* Curve line segments */}
                {pathSegments.map((seg, index) => (
                    <path
                        key={`curve-${index}`}
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
                                onMouseDown={(event) => {
                                    activeDragCancelRef.current = onTensionMouseDown(
                                        th.beat,
                                        event,
                                        lane,
                                        setTensionDrag
                                    );
                                }}
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
                {visiblePoints.map((point, ptIdx) => {
                    const cx = beatToX(point.beat);
                    const cy = valueToY(point.value);
                    const isDragging = dragPointBeat === point.beat;
                    const isHovered = hoveredBeat === point.beat;
                    const isSelected = selectedSet.has(point.beat);
                    let nodeSize = 4;
                    if (isDragging) {
                        nodeSize = 6;
                    } else if (isHovered || isSelected) {
                        nodeSize = 5;
                    }
                    const renderIife_2 = () => {
                        if (isDragging) {
                            return `drop-shadow(0 0 8px ${curveColor})`;
                        }
                        if (isHovered || isSelected) {
                            return `drop-shadow(0 0 4px ${curveColor})`;
                        }
                        return `drop-shadow(0 0 2px ${curveColor})`;
                    };

                    return (
                        <g key={`pt-${String(ptIdx)}-${point.beat}`} data-auto-point="true">
                            <circle
                                cx={cx}
                                cy={cy}
                                r={10}
                                fill="transparent"
                                className="cursor-grab"
                                onMouseDown={(event) => {
                                    activeDragCancelRef.current = onPointMouseDown(
                                        point.beat,
                                        event,
                                        lane,
                                        setDragPointBeat,
                                        setSelectedPoints,
                                        coords
                                    );
                                }}
                                onDoubleClick={(event) => handlePointDoubleClick(point.beat, event)}
                                onContextMenu={(event) => handlePointContextMenu(point.beat, event)}
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
                                    filter: renderIife_2(),
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
                        ].map((h, index) => (
                            <rect
                                key={`handle-${index}`}
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

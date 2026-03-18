import { type ReactElement, type MouseEvent as ReactMouseEvent, useState, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { automationStore } from '#/modules/Track/stores/automationStore';
import { type AutomationLane, type AutomationPoint } from '../../../useCases/workspaceViewActions';
import {
    addAutomationPoint,
    removeAutomationPoint,
    updateAutomationPoint,
    setAutomationPointCurve,
} from '../../../useCases/workspaceViewActions';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { LANE_HEIGHT, buildCurvePath } from './automationViewHelpers';

type AutomationLaneRowProps = {
    lane: AutomationLane;
    pixelsPerBeat: number;
    scrollX: number;
    containerWidth: number;
};

export const AutomationLaneRow = ({
    lane,
    pixelsPerBeat,
    scrollX,
    containerWidth,
}: AutomationLaneRowProps): ReactElement => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [dragPointBeat, setDragPointBeat] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; beat: number } | null>(null);

    const viewportStartBeat = scrollX / pixelsPerBeat;
    const viewportEndBeat = viewportStartBeat + containerWidth / pixelsPerBeat;

    const beatToX = (beat: number): number => {
        return (beat - viewportStartBeat) * pixelsPerBeat;
    };

    const valueToY = (value: number): number => {
        const normalized = (value - lane.minValue) / (lane.maxValue - lane.minValue);
        return LANE_HEIGHT - normalized * (LANE_HEIGHT - 8) - 4;
    };

    const xToBeat = (x: number): number => {
        return x / pixelsPerBeat + viewportStartBeat;
    };

    const yToValue = (y: number): number => {
        const normalized = 1 - (y - 4) / (LANE_HEIGHT - 8);
        return lane.minValue + Math.max(0, Math.min(1, normalized)) * (lane.maxValue - lane.minValue);
    };

    const visiblePoints = lane.points.filter((p) => p.beat >= viewportStartBeat - 2 && p.beat <= viewportEndBeat + 2);

    let pathD = '';
    if (visiblePoints.length > 0) {
        pathD = `M ${beatToX(visiblePoints[0]!.beat)} ${valueToY(visiblePoints[0]!.value)}`;
        for (let i = 0; i < visiblePoints.length - 1; i++) {
            pathD += ` ${buildCurvePath(visiblePoints[i]!, visiblePoints[i + 1]!, beatToX, valueToY)}`;
        }
    }

    const handleSvgClick = (e: ReactMouseEvent<SVGSVGElement>) => {
        if ((e.target as Element).closest('[data-auto-point]')) {
            return;
        }
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const beat = Math.max(0, xToBeat(x));
        const value = yToValue(y);
        const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
        addAutomationPoint(lane.id, point);
        pushUndoEntry(
            'Add automation point',
            () => removeAutomationPoint(lane.id, beat),
            () => addAutomationPoint(lane.id, point)
        );
    };

    const handlePointMouseDown = (pointBeat: number, e: ReactMouseEvent<SVGCircleElement>) => {
        e.stopPropagation();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) {
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

        const onMove = (me: MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            const newBeat = Math.max(0, xToBeat(mx));
            const newValue = yToValue(my);
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
            const finalPoint =
                finalLane?.points.find((p) => Math.abs(p.beat - currentBeat) < 0.05) ??
                finalLane?.points.find((p) => p !== undefined);
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

    const handlePointDoubleClick = (pointBeat: number, e: ReactMouseEvent<SVGCircleElement>) => {
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
    };

    const handlePointContextMenu = (pointBeat: number, e: ReactMouseEvent<SVGCircleElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, beat: pointBeat });
    };

    const handleCurveSelect = (curve: AutomationPoint['curve']) => {
        if (!contextMenu) {
            return;
        }
        setAutomationPointCurve(lane.id, contextMenu.beat, curve, 0.5);
        setContextMenu(null);
    };

    const showZeroLine = lane.minValue < 0 && lane.maxValue > 0;

    return (
        <div className="relative border-b border-border/20" style={{ height: LANE_HEIGHT }}>
            <div className="absolute top-1 left-2 z-10 flex items-center gap-1">
                <span className="text-[9px] font-medium text-muted-foreground bg-surface-base/80 px-1.5 py-0.5 rounded">
                    {lane.parameterName}
                </span>
            </div>

            <svg
                ref={svgRef}
                className="w-full h-full cursor-crosshair"
                onClick={handleSvgClick}
                style={{ width: containerWidth }}
            >
                {Array.from({ length: 5 }).map((_, i) => {
                    const y = (LANE_HEIGHT / 4) * i;
                    return (
                        <line
                            key={i}
                            x1={0}
                            y1={y}
                            x2={containerWidth}
                            y2={y}
                            stroke="rgba(255,255,255,0.05)"
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

                {pathD && (
                    <>
                        <path
                            d={`${pathD} L ${beatToX(visiblePoints[visiblePoints.length - 1]!.beat)} ${LANE_HEIGHT} L ${beatToX(visiblePoints[0]!.beat)} ${LANE_HEIGHT} Z`}
                            fill="rgba(59, 130, 246, 0.08)"
                        />
                        <path
                            d={pathD}
                            fill="none"
                            stroke="rgba(59, 130, 246, 0.7)"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </>
                )}

                {visiblePoints.map((point) => {
                    const cx = beatToX(point.beat);
                    const cy = valueToY(point.value);
                    const isDragging = dragPointBeat === point.beat;

                    return (
                        <g key={`${point.beat}-${point.value}`} data-auto-point="true">
                            <circle
                                cx={cx}
                                cy={cy}
                                r={8}
                                fill="transparent"
                                className="cursor-grab"
                                onMouseDown={(e) => handlePointMouseDown(point.beat, e)}
                                onDoubleClick={(e) => handlePointDoubleClick(point.beat, e)}
                                onContextMenu={(e) => handlePointContextMenu(point.beat, e)}
                            />
                            <circle
                                cx={cx}
                                cy={cy}
                                r={isDragging ? 5 : 4}
                                fill={isDragging ? '#60a5fa' : '#3b82f6'}
                                stroke="white"
                                strokeWidth={1.5}
                                pointerEvents="none"
                                className={cn('transition-all cursor-grab', isDragging && 'cursor-grabbing')}
                                style={{
                                    filter: isDragging
                                        ? 'drop-shadow(0 0 6px rgba(59, 130, 246, 0.6))'
                                        : 'drop-shadow(0 0 3px rgba(59, 130, 246, 0.3))',
                                }}
                            />
                            {point.curve !== 'linear' && (
                                <text
                                    x={cx + 7}
                                    y={cy - 7}
                                    className="text-[7px] fill-muted-foreground pointer-events-none"
                                >
                                    {point.curve === 's-curve' ? 'S' : point.curve === 'exponential' ? 'E' : '⌐'}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>

            {contextMenu && (
                <>
                    <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
                    <div
                        className="fixed z-50 bg-surface-overlay border border-border rounded-md shadow-xl py-1 min-w-[140px]"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <div className="px-2 py-1 text-[9px] text-muted-foreground uppercase tracking-wider">
                            Curve Type
                        </div>
                        {(['linear', 's-curve', 'exponential', 'step'] as const).map((curve) => (
                            <button
                                type="button"
                                key={curve}
                                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent/50 transition-colors capitalize"
                                onClick={() => handleCurveSelect(curve)}
                            >
                                {curve === 's-curve'
                                    ? 'S-Curve (Smooth)'
                                    : curve === 'exponential'
                                      ? 'Exponential'
                                      : curve === 'step'
                                        ? 'Step (Hold)'
                                        : 'Linear'}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

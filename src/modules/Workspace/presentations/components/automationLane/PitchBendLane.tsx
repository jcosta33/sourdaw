import { type ReactElement, type MouseEvent as ReactMouseEvent, useState, useRef, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { addPitchBend, removePitchBend, movePitchBend } from '../../../useCases/workspaceViewActions';
import { type MidiPitchBend } from '../../../useCases/workspaceViewActions';
import { PITCH_BEND_CENTER } from './laneConstants';

type PitchBendLaneProps = {
    clipId: string | null;
};

export const PitchBendLane = ({ clipId }: PitchBendLaneProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const allPb = clipId ? (midiState?.pitchBendByClipId[clipId] ?? []) : [];
    const points = [...allPb].sort((a: MidiPitchBend, b: MidiPitchBend) => a.beat - b.beat);

    const beatScale = 3;

    const beatToX = (beat: number): number => beat * beatScale + 8;
    const valueToY = (value: number, height: number): number => height - (value / 127) * (height - 8) - 4;

    const handleContainerClick = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }

        if ((e.target as HTMLElement).dataset.pbPoint) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const height = rect.height;

        const beat = Math.max(0, (x - 8) / beatScale);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const pb = addPitchBend(clipId, value, beat);
        pushUndoEntry(
            'Add pitch bend point',
            () => removePitchBend(clipId, pb.id),
            () => addPitchBend(clipId, value, beat)
        );
    };

    const handlePointMouseDown = (pbId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const origPoint = points.find((p) => p.id === pbId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        setDragId(pbId);
        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = (me: MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatScale);
            const value = Math.round(Math.max(0, Math.min(127, ((height - my - 4) / (height - 8)) * 127)));

            movePitchBend(clipId, pbId, beat, value);
        };

        const onUp = () => {
            setDragId(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalPoint = (midiStore.value?.pitchBendByClipId[clipId] ?? []).find((p) => p.id === pbId);
            if (finalPoint && (finalPoint.beat !== origBeat || finalPoint.value !== origValue)) {
                const finalBeat = finalPoint.beat;
                const finalValue = finalPoint.value;
                pushUndoEntry(
                    'Move pitch bend point',
                    () => movePitchBend(clipId, pbId, origBeat, origValue),
                    () => movePitchBend(clipId, pbId, finalBeat, finalValue)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handlePointDoubleClick = (pbId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const point = points.find((p) => p.id === pbId);
        if (point) {
            const { value, beat, channel } = point;
            removePitchBend(clipId, pbId);
            pushUndoEntry(
                'Remove pitch bend point',
                () => addPitchBend(clipId, value, beat, channel),
                () => removePitchBend(clipId, pbId)
            );
        } else {
            removePitchBend(clipId, pbId);
        }
    };

    if (!clipId) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No clip selected</p>
            </div>
        );
    }

    const containerHeight = containerRef.current?.clientHeight ?? 80;
    const centerY = valueToY(PITCH_BEND_CENTER, containerHeight);

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            onClick={handleContainerClick}
            role="group"
            aria-label="Pitch bend automation lane"
        >
            <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                <line
                    x1="0"
                    y1={centerY}
                    x2="100%"
                    y2={centerY}
                    stroke="rgba(255, 255, 255, 0.12)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                />
                {points.length > 1 && (
                    <polyline
                        fill="none"
                        stroke="rgba(80, 180, 220, 0.5)"
                        strokeWidth="1.5"
                        points={points
                            .map((p: MidiPitchBend) => {
                                const h = containerRef.current?.clientHeight ?? 80;
                                return `${beatToX(p.beat)},${valueToY(p.value, h)}`;
                            })
                            .join(' ')}
                    />
                )}
            </svg>

            {points.map((point: MidiPitchBend) => {
                const h = containerRef.current?.clientHeight ?? 80;
                const x = beatToX(point.beat);
                const y = valueToY(point.value, h);
                const isDragging = dragId === point.id;

                return (
                    <div
                        key={point.id}
                        data-pb-point="true"
                        className={cn(
                            'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400 cursor-grab transition-shadow',
                            isDragging
                                ? 'bg-cyan-300 shadow-[0_0_6px_rgba(80,180,220,0.6)] cursor-grabbing'
                                : 'bg-cyan-400/80 hover:bg-cyan-300 hover:shadow-[0_0_4px_rgba(80,180,220,0.4)]'
                        )}
                        style={{ left: x, top: y }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value} (center: ${PITCH_BEND_CENTER})`}
                        onMouseDown={(e) => handlePointMouseDown(point.id, e)}
                        onDoubleClick={(e) => handlePointDoubleClick(point.id, e)}
                    />
                );
            })}

            {points.length === 0 && (
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">
                        Click to add pitch bend points (center = no bend)
                    </p>
                </div>
            )}
        </div>
    );
};

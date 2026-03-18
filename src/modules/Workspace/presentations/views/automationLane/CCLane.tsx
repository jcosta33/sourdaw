import { type ReactElement, type MouseEvent as ReactMouseEvent, useState, useRef, useSyncExternalStore } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { midiStore } from '#/modules/Track/stores/midiStore';
import { pushUndoEntry } from '../../../useCases/workspaceViewActions';
import { addMidiCC, removeMidiCC, moveMidiCC } from '../../../useCases/workspaceViewActions';
import { type MidiCC } from '../../../useCases/workspaceViewActions';

type CCLaneProps = {
    clipId: string | null;
    controller: number;
};

export const CCLane = ({ clipId, controller }: CCLaneProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useSyncExternalStore(
        (cb) => midiStore.subscribe(() => cb()),
        () => midiStore.value,
        () => midiStore.value
    );

    const allCc = clipId ? (midiState?.ccByClipId[clipId] ?? []) : [];
    const points = [...allCc.filter((c: MidiCC) => c.controller === controller)].sort(
        (a: MidiCC, b: MidiCC) => a.beat - b.beat
    );

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
        if ((e.target as HTMLElement).dataset.ccPoint) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const height = rect.height;

        const beat = Math.max(0, (x - 8) / beatScale);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const cc = addMidiCC(clipId, controller, value, beat);
        pushUndoEntry(
            'Add CC point',
            () => removeMidiCC(clipId, cc.id),
            () => addMidiCC(clipId, controller, value, beat)
        );
    };

    const handlePointMouseDown = (ccId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const origPoint = points.find((p) => p.id === ccId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        setDragId(ccId);
        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = (me: MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatScale);
            const value = Math.round(Math.max(0, Math.min(127, ((height - my - 4) / (height - 8)) * 127)));

            moveMidiCC(clipId, ccId, beat, value);
        };

        const onUp = () => {
            setDragId(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            const finalPoint = (midiStore.value?.ccByClipId[clipId] ?? []).find((c) => c.id === ccId);
            if (finalPoint && (finalPoint.beat !== origBeat || finalPoint.value !== origValue)) {
                const finalBeat = finalPoint.beat;
                const finalValue = finalPoint.value;
                pushUndoEntry(
                    'Move CC point',
                    () => moveMidiCC(clipId, ccId, origBeat, origValue),
                    () => moveMidiCC(clipId, ccId, finalBeat, finalValue)
                );
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const handlePointDoubleClick = (ccId: string, e: ReactMouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (!clipId) {
            return;
        }
        const point = points.find((p) => p.id === ccId);
        if (point) {
            const { controller: ctrl, value, beat, channel } = point;
            removeMidiCC(clipId, ccId);
            pushUndoEntry(
                'Remove CC point',
                () => addMidiCC(clipId, ctrl, value, beat, channel),
                () => removeMidiCC(clipId, ccId)
            );
        } else {
            removeMidiCC(clipId, ccId);
        }
    };

    if (!clipId) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-[10px] text-muted-foreground">No clip selected</p>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            onClick={handleContainerClick}
            role="group"
            aria-label={`CC ${controller} automation lane`}
        >
            {points.length > 1 && (
                <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                    <polyline
                        fill="none"
                        stroke="rgba(168, 130, 255, 0.5)"
                        strokeWidth="1.5"
                        points={points
                            .map((p: MidiCC) => {
                                const el = containerRef.current;
                                const h = el?.clientHeight ?? 80;
                                return `${beatToX(p.beat)},${valueToY(p.value, h)}`;
                            })
                            .join(' ')}
                    />
                </svg>
            )}

            {points.map((point: MidiCC) => {
                const el = containerRef.current;
                const h = el?.clientHeight ?? 80;
                const x = beatToX(point.beat);
                const y = valueToY(point.value, h);
                const isDragging = dragId === point.id;

                return (
                    <div
                        key={point.id}
                        data-cc-point="true"
                        className={cn(
                            'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-purple-400 cursor-grab transition-shadow',
                            isDragging
                                ? 'bg-purple-300 shadow-[0_0_6px_rgba(168,130,255,0.6)] cursor-grabbing'
                                : 'bg-purple-400/80 hover:bg-purple-300 hover:shadow-[0_0_4px_rgba(168,130,255,0.4)]'
                        )}
                        style={{ left: x, top: y }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value}`}
                        onMouseDown={(e) => handlePointMouseDown(point.id, e)}
                        onDoubleClick={(e) => handlePointDoubleClick(point.id, e)}
                    />
                );
            })}

            {points.length === 0 && (
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">Click to add CC points</p>
                </div>
            )}
        </div>
    );
};

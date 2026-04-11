import { type ReactElement, type MouseEvent, useState, useRef } from 'react';
import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { cn } from '#/helpers/Styles/cn';
import { midiStore, addMidiCC, removeMidiCC, moveMidiCC } from '#/modules/MIDI';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { type MidiCC } from '../../../models/MidiNoteViewTypes';
import { useStore } from '#/infra/store/useStore';

type CCLaneProps = {
    clipId: string | null;
    controller: number;
    beatWidth: number;
    contentWidth: number;
};

type MidiLaneStoreState = {
    notesByClipId: Record<string, unknown[]>;
    ccByClipId: Record<string, MidiCC[]>;
    pitchBendByClipId: Record<string, unknown[]>;
};

export const CCLane = ({ clipId, controller, beatWidth }: CCLaneProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useStore<MidiLaneStoreState>(midiStore, {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    const allCc = clipId ? (midiState.ccByClipId[clipId] ?? []) : [];
    const points = [...allCc.filter((c: MidiCC) => c.controller === controller)].sort(
        (a: MidiCC, b: MidiCC) => a.beat - b.beat
    );

    const beatToX = (beat: number): number => beat * beatWidth + 8;
    const valueToY = (value: number, height: number): number => height - (value / 127) * (height - 8) - 4;

    const handleContainerClick = (e: MouseEvent<HTMLDivElement>) => {
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

        const beat = Math.max(0, (x - 8) / beatWidth);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const cc = addMidiCC(clipId, controller, value, beat);
        pushUndoEntry(
            'Add CC point',
            () => removeMidiCC(clipId, cc.id),
            () => addMidiCC(clipId, controller, value, beat)
        );
    };

    const handlePointMouseDown = (ccId: string, e: MouseEvent<HTMLDivElement>) => {
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

        const onMove = (me: globalThis.MouseEvent) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatWidth);
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

    const handlePointDoubleClick = (ccId: string, e: MouseEvent<HTMLDivElement>) => {
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
                <DawBlockedState
                    compact
                    eyebrow="Clip Automation"
                    className="max-w-xs"
                    title="No clip selected"
                    description="Choose a MIDI clip to edit this CC lane."
                    summary="Controller curves are stored per clip, so this lane activates once a clip is focused."
                />
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
            {points.length > 1 ? (
                <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                    <polyline
                        fill="none"
                        stroke="var(--color-accent-lavender)"
                        opacity="0.5"
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
            ) : null}

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
                            'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-accent-lavender)] cursor-grab transition-shadow',
                            isDragging
                                ? 'bg-[var(--color-accent-lavender)] shadow-[0_0_6px_var(--color-accent-lavender)] cursor-grabbing'
                                : 'bg-[var(--color-accent-lavender)]/80 hover:bg-[var(--color-accent-lavender)] hover:shadow-[0_0_4px_var(--color-accent-lavender)]'
                        )}
                        style={{ left: x, top: y }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value}`}
                        onMouseDown={(e) => handlePointMouseDown(point.id, e)}
                        onDoubleClick={(e) => handlePointDoubleClick(point.id, e)}
                    />
                );
            })}

            {points.length === 0 ? (
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">Click to add CC points</p>
                </div>
            ) : null}
        </div>
    );
};

import { type ReactElement, type MouseEvent, type PointerEvent, useState, useRef } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { addMidiCC, removeMidiCC, moveMidiCC } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

import { type MidiCC } from '../../../models/MidiNoteViewTypes';
import { useLaneDragSession, type LanePointerPosition } from '../../hooks/useLaneDragSession';

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
    const { hasActiveDrag, beginDrag, dragHandlers } = useLaneDragSession();
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useStore<MidiLaneStoreState>(midiStore, {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    const allCc = clipId ? (midiState.ccByClipId[clipId] ?? []) : [];
    const points = [...allCc.filter((context: MidiCC) => context.controller === controller)].sort(
        (alpha: MidiCC, b: MidiCC) => alpha.beat - b.beat
    );

    const beatToX = (beat: number): number => beat * beatWidth + 8;
    const valueToY = (value: number, height: number): number => height - (value / 127) * (height - 8) - 4;

    const handleContainerClick = (event: MouseEvent<HTMLDivElement>) => {
        if (!clipId) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }
        if ((event.target as HTMLElement).dataset.ccPoint) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
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

    const handlePointPointerDown = (ccId: string, event: PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        // Primary contact only — a right-button press belongs to the context menu, not to an edit.
        if (!clipId || hasActiveDrag() || event.button !== 0) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }
        const origPoint = points.find((param) => param.id === ccId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = ({ clientX, clientY }: LanePointerPosition) => {
            const mx = clientX - rect.left;
            const my = clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatWidth);
            const value = Math.round(Math.max(0, Math.min(127, ((height - my - 4) / (height - 8)) * 127)));

            moveMidiCC(clipId, ccId, beat, value);
        };

        const onCommit = () => {
            setDragId(null);
            const finalPoint = (midiStore.value?.ccByClipId[clipId] ?? []).find((context) => context.id === ccId);
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

        beginDrag({
            pointerId: event.pointerId,
            captureTarget: event.currentTarget,
            move: onMove,
            commit: onCommit,
        });
        setDragId(ccId);
    };

    const handlePointDoubleClick = (ccId: string, event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!clipId) {
            return;
        }
        const point = points.find((param) => param.id === ccId);
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
            <Row justify="center" className="h-full">
                <DawBlockedState
                    compact
                    eyebrow="Clip Automation"
                    className="max-w-xs"
                    title="No clip selected"
                    description="Choose a MIDI clip to edit this CC lane."
                    summary="Controller curves are stored per clip, so this lane activates once a clip is focused."
                />
            </Row>
        );
    }

    // The move/end handlers live on the lane, not on the pressed handle: a point handle unmounts
    // as soon as the lane switches controller or the point leaves the clip, and the gesture must
    // not die with it. `touchAction: 'none'` keeps the browser's own pan/zoom from claiming the
    // stroke on touch — pointerup, pointercancel and lostpointercapture all bubble up to here.
    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            style={{ touchAction: 'none' }}
            onClick={handleContainerClick}
            role="group"
            aria-label={`CC ${controller} automation lane`}
            {...dragHandlers}
        >
            {points.length > 1 ? (
                <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                    <polyline
                        fill="none"
                        stroke="var(--color-accent-lavender)"
                        opacity="0.5"
                        strokeWidth="1.5"
                        points={points
                            .map((param: MidiCC) => {
                                const el = containerRef.current;
                                const h = el?.clientHeight ?? 80;
                                return `${beatToX(param.beat)},${valueToY(param.value, h)}`;
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
                        style={{ left: x, top: y, touchAction: 'none' }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value}`}
                        onPointerDown={(event) => handlePointPointerDown(point.id, event)}
                        onDoubleClick={(event) => handlePointDoubleClick(point.id, event)}
                    />
                );
            })}
            {points.length === 0 ? (
                <Row justify="center" className="h-full pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">Click to add CC points</p>
                </Row>
            ) : null}
        </div>
    );
};

import { type ReactElement, type MouseEvent, type PointerEvent, useState, useRef } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { addPitchBend, removePitchBend, movePitchBend } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

import { type MidiPitchBend } from '../../../models/MidiNoteViewTypes';
import { PITCH_BEND_CENTER } from '../../helpers/laneConstants';
import { useLaneDragSession, type LanePointerPosition } from '../../hooks/useLaneDragSession';

type PitchBendLaneProps = {
    clipId: string | null;
    beatWidth: number;
    contentWidth: number;
};

type PitchBendLaneStoreState = {
    notesByClipId: Record<string, unknown[]>;
    ccByClipId: Record<string, unknown[]>;
    pitchBendByClipId: Record<string, MidiPitchBend[]>;
};

export const PitchBendLane = ({ clipId, beatWidth }: PitchBendLaneProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { hasActiveDrag, beginDrag, dragHandlers } = useLaneDragSession();
    const [dragId, setDragId] = useState<string | null>(null);

    const midiState = useStore<PitchBendLaneStoreState>(midiStore, {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    });

    const allPb = clipId ? (midiState.pitchBendByClipId[clipId] ?? []) : [];
    const points = [...allPb].sort((alpha: MidiPitchBend, b: MidiPitchBend) => alpha.beat - b.beat);

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

        if ((event.target as HTMLElement).dataset.pbPoint) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const height = rect.height;

        const beat = Math.max(0, (x - 8) / beatWidth);
        const value = Math.round(Math.max(0, Math.min(127, ((height - y - 4) / (height - 8)) * 127)));

        const pb = addPitchBend(clipId, value, beat);
        pushUndoEntry(
            'Add pitch bend point',
            () => removePitchBend(clipId, pb.id),
            () => addPitchBend(clipId, value, beat)
        );
    };

    const handlePointPointerDown = (pbId: string, event: PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        // Primary contact only — a right-button press belongs to the context menu, not to an edit.
        if (!clipId || hasActiveDrag() || event.button !== 0) {
            return;
        }
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const origPoint = points.find((param) => param.id === pbId);
        const origBeat = origPoint?.beat ?? 0;
        const origValue = origPoint?.value ?? 0;

        const rect = container.getBoundingClientRect();
        const height = rect.height;

        const onMove = ({ clientX, clientY }: LanePointerPosition) => {
            const mx = clientX - rect.left;
            const my = clientY - rect.top;

            const beat = Math.max(0, (mx - 8) / beatWidth);
            const value = Math.round(Math.max(0, Math.min(127, ((height - my - 4) / (height - 8)) * 127)));

            movePitchBend(clipId, pbId, beat, value);
        };

        const onCommit = () => {
            setDragId(null);
            const finalPoint = (midiStore.value?.pitchBendByClipId[clipId] ?? []).find((param) => param.id === pbId);
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

        beginDrag({
            pointerId: event.pointerId,
            captureTarget: event.currentTarget,
            move: onMove,
            commit: onCommit,
        });
        setDragId(pbId);
    };

    const handlePointDoubleClick = (pbId: string, event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!clipId) {
            return;
        }
        const point = points.find((param) => param.id === pbId);
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
            <Row justify="center" className="h-full">
                <DawBlockedState
                    compact
                    eyebrow="Clip Automation"
                    className="max-w-xs"
                    title="No clip selected"
                    description="Choose a MIDI clip to edit its pitch bend lane."
                    summary="Pitch bend is edited per clip, with the center line and gesture curve appearing once a clip is focused."
                />
            </Row>
        );
    }

    const containerHeight = containerRef.current?.clientHeight ?? 80;
    const centerY = valueToY(PITCH_BEND_CENTER, containerHeight);

    // The move/end handlers live on the lane, not on the pressed handle: a point handle unmounts
    // as soon as the editor focuses another clip or the point leaves it, and the gesture must not
    // die with it. `touchAction: 'none'` keeps the browser's own pan/zoom from claiming the stroke
    // on touch — pointerup, pointercancel and lostpointercapture all bubble up to here.
    return (
        <div
            ref={containerRef}
            className="relative h-full w-full cursor-crosshair overflow-hidden"
            style={{ touchAction: 'none' }}
            onClick={handleContainerClick}
            role="group"
            aria-label="Pitch bend automation lane"
            {...dragHandlers}
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
                {points.length > 1 ? (
                    <polyline
                        fill="none"
                        stroke="rgba(80, 180, 220, 0.5)"
                        strokeWidth="1.5"
                        points={points
                            .map((param: MidiPitchBend) => {
                                const h = containerRef.current?.clientHeight ?? 80;
                                return `${beatToX(param.beat)},${valueToY(param.value, h)}`;
                            })
                            .join(' ')}
                    />
                ) : null}
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
                            'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-accent-cyan)] cursor-grab transition-shadow',
                            isDragging
                                ? 'bg-[var(--color-accent-cyan)] shadow-[0_0_6px_rgba(80,180,220,0.6)] cursor-grabbing'
                                : 'bg-[var(--color-accent-cyan)]/80 hover:bg-[var(--color-accent-cyan)] hover:shadow-[0_0_4px_rgba(80,180,220,0.4)]'
                        )}
                        style={{ left: x, top: y, touchAction: 'none' }}
                        title={`Beat ${point.beat.toFixed(2)}: ${point.value} (center: ${PITCH_BEND_CENTER})`}
                        onPointerDown={(event) => handlePointPointerDown(point.id, event)}
                        onDoubleClick={(event) => handlePointDoubleClick(point.id, event)}
                    />
                );
            })}
            {points.length === 0 ? (
                <Row justify="center" className="h-full pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">
                        Click to add pitch bend points (center = no bend)
                    </p>
                </Row>
            ) : null}
        </div>
    );
};

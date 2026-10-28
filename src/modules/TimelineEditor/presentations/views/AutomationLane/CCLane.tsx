import { type ReactElement, type MouseEvent, type PointerEvent, useState, useRef } from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { Row } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    addMidiCC,
    removeMidiCC,
    moveMidiCC,
    restoreMidiCCPoints,
    revisitHandEditedCCReturns,
} from '#/modules/MIDI/useCases';
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

function readCCRows(clipId: string): readonly MidiCC[] {
    return midiStore.value?.ccByClipId[clipId] ?? [];
}

function sameCCRow(first: MidiCC, second: MidiCC): boolean {
    return (
        first.id === second.id &&
        first.controller === second.controller &&
        first.value === second.value &&
        first.beat === second.beat &&
        first.channel === second.channel
    );
}

/** Undo only this transition's writes while retaining rows changed independently since it committed. */
function restoreChangedCCRows(clipId: string, before: readonly MidiCC[], after: readonly MidiCC[]): void {
    const beforeById = new Map(before.map((row) => [row.id, row]));
    const afterById = new Map(after.map((row) => [row.id, row]));
    const currentById = new Map(readCCRows(clipId).map((row) => [row.id, row]));
    // Compare only ids present on both sides: inserted or removed rows shift indexes
    // without changing a surviving row's order relative to the other survivors.
    const previousStanding = before.filter((row) => afterById.has(row.id));
    const nextStanding = after.filter((row) => beforeById.has(row.id));
    const reorderedIds = new Set(
        previousStanding.filter((row, index) => row.id !== nextStanding[index]?.id).map((row) => row.id)
    );
    const removedIds = new Set<string>();
    for (const row of after) {
        const previous = beforeById.get(row.id);
        if (previous && sameCCRow(previous, row) && !reorderedIds.has(row.id)) {
            continue;
        }
        const current = currentById.get(row.id);
        if (current && sameCCRow(current, row)) {
            removeMidiCC(clipId, row.id);
            removedIds.add(row.id);
        }
    }
    const restored = before.filter((row) => {
        const committed = afterById.get(row.id);
        if (!committed) {
            return !currentById.has(row.id);
        }
        return (!sameCCRow(row, committed) || reorderedIds.has(row.id)) && removedIds.has(row.id);
    });
    if (restored.length > 0) {
        restoreMidiCCPoints(clipId, restored, before);
    }
}

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

        const channel = 0;
        // Capture the actual row transition: returned families can reuse ids or shrink,
        // while a gesture on another controller may not touch them at all.
        let beforeChange = readCCRows(clipId);
        const cc = addMidiCC(clipId, controller, value, beat, channel);
        let afterChange = readCCRows(clipId);
        const redo = (): void => {
            beforeChange = readCCRows(clipId);
            addMidiCC(clipId, cc.controller, cc.value, cc.beat, cc.channel, cc.id);
            afterChange = readCCRows(clipId);
        };
        pushUndoEntry('Add CC point', () => restoreChangedCCRows(clipId, beforeChange, afterChange), redo);
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
                // Moving a hand point off or along a clip's head changes what its returns must restore, so
                // both the head it left and the one it joined are revisited on commit and redo.
                // Undo restores their captured rows because a revisit is not an inverse.
                const edited = { editedController: finalPoint.controller, editedRowId: finalPoint.id };
                const revisitBothEnds = (): void => {
                    revisitHandEditedCCReturns(clipId, { channel: finalPoint.channel, beat: origBeat }, edited);
                    revisitHandEditedCCReturns(clipId, { channel: finalPoint.channel, beat: finalBeat }, edited);
                };
                // Only the dragged row predates the gesture. Other rows are captured now,
                // so an independent edit made during the drag never becomes part of its inverse.
                let beforeChange = readCCRows(clipId).map((row) => {
                    if (row.id === ccId) {
                        return { ...row, beat: origBeat, value: origValue };
                    }
                    return row;
                });
                revisitBothEnds();
                let afterChange = readCCRows(clipId);
                pushUndoEntry(
                    'Move CC point',
                    () => restoreChangedCCRows(clipId, beforeChange, afterChange),
                    () => {
                        beforeChange = [...readCCRows(clipId)];
                        moveMidiCC(clipId, ccId, finalBeat, finalValue);
                        revisitBothEnds();
                        afterChange = readCCRows(clipId);
                    }
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
            const head = { channel: point.channel, beat: point.beat };
            const edited = { editedController: point.controller, editedRowId: point.id };
            let beforeChange = readCCRows(clipId);
            removeMidiCC(clipId, ccId);
            revisitHandEditedCCReturns(clipId, head, edited);
            let afterChange = readCCRows(clipId);
            pushUndoEntry(
                'Remove CC point',
                () => restoreChangedCCRows(clipId, beforeChange, afterChange),
                () => {
                    beforeChange = readCCRows(clipId);
                    removeMidiCC(clipId, ccId);
                    revisitHandEditedCCReturns(clipId, head, edited);
                    afterChange = readCCRows(clipId);
                }
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

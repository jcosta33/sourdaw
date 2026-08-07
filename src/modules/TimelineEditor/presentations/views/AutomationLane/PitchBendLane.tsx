import {
    type ReactElement,
    type MouseEvent,
    type PointerEvent,
    type RefObject,
    useState,
    useRef,
    useEffect,
} from 'react';

import { DawBlockedState } from '#/components/daw/DawBlockedState';
import { useStore } from '#/infra/store/useStore';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { addPitchBend, removePitchBend, movePitchBend } from '#/modules/MIDI/useCases';
import { cn } from '#/utils/Styles/cn';

import { type MidiPitchBend } from '../../../models/MidiNoteViewTypes';
import { PITCH_BEND_CENTER } from '../../helpers/laneConstants';

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

type LanePointerPosition = {
    clientX: number;
    clientY: number;
};

/**
 * One in-flight drag gesture. The pointer is captured on `captureTarget`, so every
 * subsequent event for `pointerId` is retargeted there by the browser — no window
 * listeners, and a release outside the window still arrives as pointerup/pointercancel.
 */
type LaneDragSession = {
    pointerId: number;
    captureTarget: Element;
    move: (position: LanePointerPosition) => void;
    commit: () => void;
};

/**
 * End the in-flight gesture exactly once. What guarantees that is the clear happening *at all*,
 * synchronously, before this returns: the trailing `pointerup`/`lostpointercapture` the browser
 * still delivers then finds no gesture to finalize. Placing the clear ahead of `commit()` is cheap
 * insurance against a future re-entrant commit only — `releasePointerCapture()` merely nulls the
 * pending capture target, and `lostpointercapture` fires from the process-pending-pointer-capture
 * steps before the next pointer event rather than synchronously here (Blink matches the spec), so
 * no current path re-enters and no test can red the ordering. See M16 on the PR.
 */
const finalizeLaneDrag = (sessionRef: RefObject<LaneDragSession | null>): void => {
    const session = sessionRef.current;
    if (!session) {
        return;
    }
    sessionRef.current = null;
    try {
        session.captureTarget.releasePointerCapture(session.pointerId);
    } catch {
        // The browser releases capture itself on pointercancel and on element removal.
    }
    session.commit();
};

export const PitchBendLane = ({ clipId, beatWidth }: PitchBendLaneProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);
    const dragSessionRef = useRef<LaneDragSession | null>(null);
    const [dragId, setDragId] = useState<string | null>(null);

    useEffect(() => {
        const handleWindowBlur = (): void => {
            finalizeLaneDrag(dragSessionRef);
        };
        const handleVisibilityChange = (): void => {
            if (document.visibilityState === 'hidden') {
                finalizeLaneDrag(dragSessionRef);
            }
        };

        window.addEventListener('blur', handleWindowBlur);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('blur', handleWindowBlur);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        return () => {
            finalizeLaneDrag(dragSessionRef);
        };
    }, []);

    /**
     * Capture first, arm second. Unlike NotePropertyLane the pointerdown here writes no value, so
     * the ordering is not protecting a write — it is protecting the arm. Swap these two lines and
     * a `setPointerCapture` that throws leaves `dragSessionRef.current` set with no capture, and
     * the live-session guard in `handlePointPointerDown` then refuses every later press: the lane
     * is dead until it remounts.
     */
    const beginDrag = (session: LaneDragSession): void => {
        session.captureTarget.setPointerCapture(session.pointerId);
        dragSessionRef.current = session;
    };

    const handleDragMove = (event: PointerEvent<Element>): void => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        session.move({ clientX: event.clientX, clientY: event.clientY });
    };

    const handleDragEnd = (event: PointerEvent<Element>): void => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) {
            return;
        }
        finalizeLaneDrag(dragSessionRef);
    };

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
        if (!clipId || dragSessionRef.current || event.button !== 0) {
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
            <div className="flex h-full items-center justify-center">
                <DawBlockedState
                    compact
                    eyebrow="Clip Automation"
                    className="max-w-xs"
                    title="No clip selected"
                    description="Choose a MIDI clip to edit its pitch bend lane."
                    summary="Pitch bend is edited per clip, with the center line and gesture curve appearing once a clip is focused."
                />
            </div>
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
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            onLostPointerCapture={handleDragEnd}
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
                <div className="flex h-full items-center justify-center pointer-events-none">
                    <p className="text-[10px] text-muted-foreground">
                        Click to add pitch bend points (center = no bend)
                    </p>
                </div>
            ) : null}
        </div>
    );
};

import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Circle, Eraser, Link2, Lock, Play, Plus, Square, Undo2, Unlock, Unlink } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { LED } from '#/components/daw/LED';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { cn } from '#/utils/Styles/cn';

import {
    loopStationStore,
    type LoopSlot,
    type LoopSlotState,
    type LoopStationState,
} from '../../stores/loopStationStore';
import { clearSlot } from '../../useCases/loopStation/clearSlot';
import { createSlot } from '../../useCases/loopStation/createSlot';
import { setFixedLoopLength } from '../../useCases/loopStation/setFixedLoopLength';
import { stopAllSlots } from '../../useCases/loopStation/stopAllSlots';
import { stopSlot } from '../../useCases/loopStation/stopSlot';
import { toggleArm } from '../../useCases/loopStation/toggleArm';
import { toggleRecord } from '../../useCases/loopStation/toggleRecord';
import { toggleSync } from '../../useCases/loopStation/toggleSync';
import { triggerSlot } from '../../useCases/loopStation/triggerSlot';
import { undoLastLayer } from '../../useCases/loopStation/undoLastLayer';
import { formatBarBeat, formatLoopProgress } from '../helpers/loopStationProgress';

const emptyLoopState: LoopStationState = {
    slots: [],
    sceneCount: 8,
    activeScene: 0,
    armed: false,
    syncToTransport: true,
    fixedLoopLength: 0,
};

const SLOT_STATE_VARIANT: Record<LoopSlotState, 'cyan' | 'mint' | 'amber' | 'red'> = {
    empty: 'cyan',
    recording: 'red',
    overdubbing: 'red',
    playing: 'mint',
    stopped: 'amber',
};

const SLOT_STATE_LABEL: Record<LoopSlotState, string> = {
    empty: 'Empty',
    recording: 'Rec',
    overdubbing: 'Dub',
    playing: 'Play',
    stopped: 'Stop',
};

function getSlotBackgroundClass(state: LoopSlotState): string {
    if (state === 'recording' || state === 'overdubbing') {
        return 'bg-[var(--color-state-record)]/15';
    }
    if (state === 'playing') {
        return 'bg-[var(--color-accent-mint)]/10';
    }
    return 'bg-surface-inset';
}

type TrackRef = { id: string; name: string; color: string | null };

function toTrackRef(track: { id: string; name: string; color?: string | null }): TrackRef {
    return { id: track.id, name: track.name, color: track.color ?? null };
}

function getSlot(slots: LoopSlot[], trackId: string, row: number): LoopSlot | undefined {
    return slots.find((slot) => slot.trackId === trackId && slot.row === row);
}

type LoopSlotProgressReadoutProps = {
    slot: LoopSlot;
    numerator: number;
    discretePlayheadPosition: number;
};

/**
 * Isolates the per-frame ticking progress readout from the rest of the cell
 * (F10). The grid can hold many occupied cells; previously the parent lifted
 * the ticking playhead position into React state and passed it down as
 * `positionBeats` on every cell, which made each cell's element depend on a
 * value that changes every animation frame — invalidating that reactive
 * scope and re-invoking the whole cell body (including its five `Button`s)
 * once per frame, for every occupied cell, active or not.
 *
 * This leaf instead reads the non-reactive `playheadPositionRef` directly via
 * its own rAF loop (mirroring `PlayheadDisplay`, the existing pattern in this
 * codebase for exactly this problem) and writes the formatted text straight
 * to its own DOM node, so ticking never touches React state or the parent
 * cell's props. `isActive` is derived from this slot's own state, not a
 * panel-wide flag — only a slot that is itself playing/recording/overdubbing
 * ticks every frame; every other occupied cell only recomputes when
 * `discretePlayheadPosition` changes (start/stop/seek), so per-frame work
 * scales with active slots, not with grid size.
 */
const LoopSlotProgressReadout = ({
    slot,
    numerator,
    discretePlayheadPosition,
}: LoopSlotProgressReadoutProps): ReactElement => {
    const progressRef = useRef<HTMLSpanElement>(null);
    const isActive = slot.state === 'playing' || slot.state === 'recording' || slot.state === 'overdubbing';

    useEffect(() => {
        const updateOnce = (): void => {
            const text = formatLoopProgress(slot, playheadPositionRef.current, numerator);
            if (progressRef.current) {
                progressRef.current.textContent = text;
            }
        };
        updateOnce();
        if (!isActive) {
            return undefined;
        }
        let raf = 0;
        const tick = (): void => {
            updateOnce();
            raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(raf);
    }, [slot, numerator, isActive, discretePlayheadPosition]);

    return (
        <span
            ref={progressRef}
            data-testid="loop-slot-progress"
            className="ml-auto font-mono text-[9px] text-muted-foreground tabular-nums"
        >
            {formatLoopProgress(slot, discretePlayheadPosition, numerator)}
        </span>
    );
};

type LoopStationSlotCellProps = {
    trackId: string;
    row: number;
    slot: LoopSlot | undefined;
    numerator: number;
    discretePlayheadPosition: number;
};

const LoopStationSlotCell = ({
    trackId,
    row,
    slot,
    numerator,
    discretePlayheadPosition,
}: LoopStationSlotCellProps): ReactElement => {
    if (!slot) {
        return (
            <Row
                justify="center"
                className="h-14 border-b border-r border-border-hairline bg-black/10 transition-colors hover:bg-white/[0.04]"
            >
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 opacity-40 hover:opacity-100"
                    aria-label={`Create loop slot row ${row + 1}`}
                    onClick={() => createSlot(trackId, row, row)}
                >
                    <Plus className="size-2.5" />
                </Button>
            </Row>
        );
    }

    const variant = SLOT_STATE_VARIANT[slot.state];
    const stateLabel = SLOT_STATE_LABEL[slot.state];
    const hasContent = slot.layers.length > 0 || slot.state !== 'empty';

    return (
        <div
            className={cn(
                'flex h-14 flex-col gap-1 border-b border-r border-border-hairline px-1.5 py-1 transition-colors',
                getSlotBackgroundClass(slot.state)
            )}
        >
            <Row gap={1}>
                <LED on={hasContent} variant={variant} size="sm" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-secondary">
                    {stateLabel}
                </span>
                <span className="ml-auto font-mono text-[9px] text-muted-foreground tabular-nums">
                    {slot.layers.length}L
                </span>
            </Row>
            <Row gap={0.5}>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    aria-label={`Record or overdub slot ${row + 1}`}
                    onClick={() => toggleRecord(slot.id)}
                >
                    <Circle
                        className={cn(
                            'size-2.5',
                            slot.state === 'recording' || slot.state === 'overdubbing'
                                ? 'fill-[var(--color-state-record)] text-[var(--color-state-record)]'
                                : 'text-text-primary'
                        )}
                    />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    aria-label={`Play slot ${row + 1}`}
                    disabled={slot.layers.length === 0}
                    onClick={() => triggerSlot(slot.id)}
                >
                    <Play
                        className={cn(
                            'size-2.5',
                            slot.state === 'playing'
                                ? 'fill-[var(--color-accent-mint)] text-[var(--color-accent-mint)]'
                                : ''
                        )}
                    />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    aria-label={`Stop slot ${row + 1}`}
                    onClick={() => stopSlot(slot.id)}
                >
                    <Square className="size-2.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    aria-label={`Undo last layer on slot ${row + 1}`}
                    disabled={slot.layers.length === 0}
                    onClick={() => undoLastLayer(slot.id)}
                >
                    <Undo2 className="size-2.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5"
                    aria-label={`Clear slot ${row + 1}`}
                    onClick={() => clearSlot(slot.id)}
                >
                    <Eraser className="size-2.5" />
                </Button>
                <LoopSlotProgressReadout
                    slot={slot}
                    numerator={numerator}
                    discretePlayheadPosition={discretePlayheadPosition}
                />
            </Row>
        </div>
    );
};

export const LoopStationPanel = (): ReactElement => {
    const loopState = useStore(loopStationStore, emptyLoopState);
    const trackState = useStore(trackStore, defaultTrackState);
    const transport = useStore(transportStore, defaultTransportState);
    const tracks: TrackRef[] = trackState.tracks.map(toTrackRef);
    const rowCount = Math.max(8, loopState.sceneCount);

    // Whether *any* slot is active, purely to gate the header's own "Bar X.X"
    // ticking below (F10). Each cell's own progress readout derives its
    // activity from its own slot's state instead of this panel-wide flag, so
    // per-frame ticking is bounded by how many slots are actually active, not
    // by grid size.
    const isActive = loopState.slots.some(
        (slot) => slot.state === 'playing' || slot.state === 'recording' || slot.state === 'overdubbing'
    );
    const discretePlayheadPosition = transport.playheadPosition;

    // Drives only the header's "Bar X.X" readout below. Per-cell progress
    // reads `playheadPositionRef` directly via its own isolated rAF loop
    // (`LoopSlotProgressReadout`) instead of subscribing to this state, so a
    // tick here no longer invalidates every cell's props on every frame.
    const [tickPosition, setTickPosition] = useState(0);

    useEffect(() => {
        if (!isActive) {
            setTickPosition(discretePlayheadPosition);
            return undefined;
        }
        let raf = 0;
        const tick = (): void => {
            setTickPosition(playheadPositionRef.current);
            raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(raf);
    }, [isActive, discretePlayheadPosition]);

    const fixedLoopLength = loopState.fixedLoopLength;
    const [fixedInput, setFixedInput] = useState<string>(String(fixedLoopLength));

    useEffect(() => {
        setFixedInput(String(fixedLoopLength));
    }, [fixedLoopLength]);

    const commitFixedLoopLength = (): void => {
        const parsed = Number.parseFloat(fixedInput);
        const next = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        setFixedLoopLength(next);
        setFixedInput(String(next));
    };

    const syncIndicator = loopState.syncToTransport
        ? `Bar ${formatBarBeat(tickPosition, transport.timeSignatureNumerator)}`
        : 'Free';

    return (
        <DawPanelSurface role="region" aria-label="Loop station">
            <DawHeaderBand
                className="shrink-0"
                title="Loop Station"
                titleClassName="text-[11px] font-semibold text-foreground uppercase tracking-wider"
                actions={
                    <Row gap={1}>
                        <span
                            className={cn(
                                'font-mono text-[10px] tabular-nums',
                                loopState.syncToTransport ? 'text-[var(--color-accent-mint)]' : 'text-muted-foreground'
                            )}
                            aria-live="polite"
                        >
                            {syncIndicator}
                        </span>
                        <Button
                            variant={loopState.syncToTransport ? 'secondary' : 'ghost'}
                            size="xs"
                            aria-label={
                                loopState.syncToTransport ? 'Disable sync to transport' : 'Enable sync to transport'
                            }
                            onClick={toggleSync}
                        >
                            {loopState.syncToTransport ? <Link2 className="size-3" /> : <Unlink className="size-3" />}
                            <span className="ml-1">Sync</span>
                        </Button>
                        <Button
                            variant={loopState.armed ? 'secondary' : 'ghost'}
                            size="xs"
                            className={loopState.armed ? 'text-[var(--color-state-record)]' : ''}
                            aria-label={loopState.armed ? 'Disarm loop station' : 'Arm loop station'}
                            onClick={toggleArm}
                        >
                            {loopState.armed ? <Unlock className="size-3" /> : <Lock className="size-3" />}
                            <span className="ml-1">Arm</span>
                        </Button>
                        <Row as="label" gap={1} className="text-[10px] text-muted-foreground">
                            <span>Length</span>
                            <Input
                                type="number"
                                min={0}
                                step={1}
                                value={fixedInput}
                                onChange={(event) => setFixedInput(event.target.value)}
                                onBlur={commitFixedLoopLength}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        commitFixedLoopLength();
                                    }
                                }}
                                className="h-6 w-14 px-1 text-[10px]"
                                aria-label="Fixed loop length in beats (0 = auto)"
                            />
                        </Row>
                        <Button variant="ghost" size="xs" aria-label="Stop all loops" onClick={stopAllSlots}>
                            <Square className="size-3" />
                            <span className="ml-1">Stop all</span>
                        </Button>
                    </Row>
                }
            />

            {tracks.length === 0 ? (
                <Row justify="center" grow className="p-6">
                    <DawEmptyState
                        title="No tracks to loop"
                        description="Add a track to start recording loop station slots."
                        className="max-w-sm"
                    />
                </Row>
            ) : (
                <div className="flex-1 overflow-auto">
                    <Row align="stretch" className="min-w-max" role="grid" aria-label="Loop slots">
                        <Stack shrink={false} className="w-16 border-r border-border-hairline bg-black/20">
                            <Row
                                justify="center"
                                className="h-6 border-b border-border-hairline text-[9px] uppercase tracking-wider text-muted-foreground"
                            >
                                Slot
                            </Row>
                            {Array.from({ length: rowCount }, (_, row) => (
                                <Row
                                    justify="center"
                                    className="h-14 border-b border-border-hairline text-[10px] font-mono text-muted-foreground"
                                    key={row}
                                >
                                    {row + 1}
                                </Row>
                            ))}
                        </Stack>

                        {tracks.map((track) => (
                            <Stack shrink={false} className="w-44" key={track.id}>
                                <Row
                                    className="h-6 border-b border-r border-border-hairline px-2 text-[10px] font-medium text-foreground"
                                    style={{
                                        borderLeft:
                                            track.color !== null && track.color !== undefined
                                                ? `2px solid ${track.color}`
                                                : undefined,
                                    }}
                                    title={track.name}
                                >
                                    <span className="truncate">{track.name}</span>
                                </Row>
                                {Array.from({ length: rowCount }, (_, row) => (
                                    <LoopStationSlotCell
                                        key={row}
                                        trackId={track.id}
                                        row={row}
                                        slot={getSlot(loopState.slots, track.id, row)}
                                        numerator={transport.timeSignatureNumerator}
                                        discretePlayheadPosition={discretePlayheadPosition}
                                    />
                                ))}
                            </Stack>
                        ))}
                    </Row>
                </div>
            )}
        </DawPanelSurface>
    );
};

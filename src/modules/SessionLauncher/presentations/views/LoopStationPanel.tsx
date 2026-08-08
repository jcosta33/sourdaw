import { type ReactElement, useEffect, useState } from 'react';

import { Circle, Eraser, Link2, Lock, Play, Plus, Square, Undo2, Unlock, Unlink } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { LED } from '#/components/daw/LED';
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

function formatBarBeat(positionBeats: number, numerator: number): string {
    if (numerator <= 0) {
        return '1.1';
    }
    const safeBeat = Math.max(0, positionBeats);
    const bar = Math.floor(safeBeat / numerator) + 1;
    const beat = Math.floor(safeBeat % numerator) + 1;
    return `${bar}.${beat}`;
}

function formatLoopProgress(slot: LoopSlot, positionBeats: number, numerator: number): string {
    if (slot.lengthBeats <= 0) {
        return `—`;
    }
    const localBeat = ((positionBeats % slot.lengthBeats) + slot.lengthBeats) % slot.lengthBeats;
    return formatBarBeat(localBeat, numerator);
}

type LoopStationSlotCellProps = {
    trackId: string;
    row: number;
    slot: LoopSlot | undefined;
    positionBeats: number;
    numerator: number;
};

const LoopStationSlotCell = ({
    trackId,
    row,
    slot,
    positionBeats,
    numerator,
}: LoopStationSlotCellProps): ReactElement => {
    if (!slot) {
        return (
            <div className="flex h-14 items-center justify-center border-b border-r border-border-hairline bg-black/10 transition-colors hover:bg-white/[0.04]">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 opacity-40 hover:opacity-100"
                    aria-label={`Create loop slot row ${row + 1}`}
                    onClick={() => createSlot(trackId, row, row)}
                >
                    <Plus className="size-2.5" />
                </Button>
            </div>
        );
    }

    const variant = SLOT_STATE_VARIANT[slot.state];
    const stateLabel = SLOT_STATE_LABEL[slot.state];
    const hasContent = slot.layers.length > 0 || slot.state !== 'empty';
    const progress = formatLoopProgress(slot, positionBeats, numerator);

    return (
        <div
            className={cn(
                'flex h-14 flex-col gap-1 border-b border-r border-border-hairline px-1.5 py-1 transition-colors',
                getSlotBackgroundClass(slot.state)
            )}
        >
            <div className="flex items-center gap-1">
                <LED on={hasContent} variant={variant} size="sm" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-text-secondary">
                    {stateLabel}
                </span>
                <span className="ml-auto font-mono text-[9px] text-muted-foreground tabular-nums">
                    {slot.layers.length}L
                </span>
            </div>
            <div className="flex items-center gap-0.5">
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
                <span className="ml-auto font-mono text-[9px] text-muted-foreground tabular-nums">{progress}</span>
            </div>
        </div>
    );
};

export const LoopStationPanel = (): ReactElement => {
    const loopState = useStore(loopStationStore, emptyLoopState);
    const trackState = useStore(trackStore, defaultTrackState);
    const transport = useStore(transportStore, defaultTransportState);
    const tracks: TrackRef[] = trackState.tracks.map(toTrackRef);
    const rowCount = Math.max(8, loopState.sceneCount);

    const [tickPosition, setTickPosition] = useState(0);

    useEffect(() => {
        const isActive = loopState.slots.some(
            (slot) => slot.state === 'playing' || slot.state === 'recording' || slot.state === 'overdubbing'
        );
        if (!isActive) {
            setTickPosition(transport.playheadPosition);
            return undefined;
        }
        let raf = 0;
        const tick = (): void => {
            setTickPosition(playheadPositionRef.current);
            raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(raf);
    }, [loopState.slots, transport.playheadPosition]);

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
                    <div className="flex items-center gap-1">
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
                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
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
                        </label>
                        <Button variant="ghost" size="xs" aria-label="Stop all loops" onClick={stopAllSlots}>
                            <Square className="size-3" />
                            <span className="ml-1">Stop all</span>
                        </Button>
                    </div>
                }
            />

            {tracks.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-6">
                    <DawEmptyState
                        title="No tracks to loop"
                        description="Add a track to start recording loop station slots."
                        className="max-w-sm"
                    />
                </div>
            ) : (
                <div className="flex-1 overflow-auto">
                    <div className="flex min-w-max" role="grid" aria-label="Loop slots">
                        <div className="flex w-16 shrink-0 flex-col border-r border-border-hairline bg-black/20">
                            <div className="flex h-6 items-center justify-center border-b border-border-hairline text-[9px] uppercase tracking-wider text-muted-foreground">
                                Slot
                            </div>
                            {Array.from({ length: rowCount }, (_, row) => (
                                <div
                                    key={row}
                                    className="flex h-14 items-center justify-center border-b border-border-hairline text-[10px] font-mono text-muted-foreground"
                                >
                                    {row + 1}
                                </div>
                            ))}
                        </div>

                        {tracks.map((track) => (
                            <div key={track.id} className="flex w-44 shrink-0 flex-col">
                                <div
                                    className="flex h-6 items-center border-b border-r border-border-hairline px-2 text-[10px] font-medium text-foreground"
                                    style={{
                                        borderLeft:
                                            track.color !== null && track.color !== undefined
                                                ? `2px solid ${track.color}`
                                                : undefined,
                                    }}
                                    title={track.name}
                                >
                                    <span className="truncate">{track.name}</span>
                                </div>
                                {Array.from({ length: rowCount }, (_, row) => (
                                    <LoopStationSlotCell
                                        key={row}
                                        trackId={track.id}
                                        row={row}
                                        slot={getSlot(loopState.slots, track.id, row)}
                                        positionBeats={tickPosition}
                                        numerator={transport.timeSignatureNumerator}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </DawPanelSurface>
    );
};

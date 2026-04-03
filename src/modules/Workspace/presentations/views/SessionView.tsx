/**
 * Session / Clip Launcher View.
 * Ableton-style vertical grid of clip slots with scene triggers.
 * Each track has a column of clip slots; each row is a scene.
 */
import { type ReactElement, useState } from 'react';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawGridHeaderCell } from '#/components/daw/DawGridHeaderCell';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawSideRail } from '#/components/daw/DawSideRail';
import { cn } from '#/helpers/Styles/cn';
import { Button } from '#/components/ui/button';
import { Play, Square, Plus } from 'lucide-react';
import { useTracks } from '../hooks/useTracks';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

const SCENE_COUNT = 8;

export const SessionView = (): ReactElement => {
    const { tracks } = useTracks();
    const [activeSlots, setActiveSlots] = useState<Map<string, number>>(new Map());

    const handleLaunchSlot = (trackId: string, sceneIndex: number): void => {
        setActiveSlots((prev) => {
            const next = new Map(prev);
            if (next.get(trackId) === sceneIndex) {
                next.delete(trackId);
            } else {
                next.set(trackId, sceneIndex);
            }
            return next;
        });
    };

    const handleLaunchScene = (sceneIndex: number): void => {
        setActiveSlots((prev) => {
            const next = new Map(prev);
            for (const t of tracks) {
                next.set(t.id, sceneIndex);
            }
            return next;
        });
    };

    const handleStopAll = (): void => {
        setActiveSlots(new Map());
    };

    // Map clips to scenes: each track's clips are distributed across scene slots
    const getClipForSlot = (trackId: string, sceneIndex: number): string | null => {
        const track = tracks.find((t: Track) => t.id === trackId);
        if (!track || !track.clips) {
            return null;
        }
        const clipArray = Object.values(track.clips) as Array<{ id: string }>;
        return clipArray[sceneIndex]?.id ?? null;
    };

    return (
        <div className="flex flex-col h-full bg-surface-base">
            <DawHeaderBand
                className="shrink-0"
                title="Session"
                titleClassName="text-[11px] font-semibold text-foreground uppercase tracking-wider"
                actions={
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleStopAll}
                        aria-label="Stop all clips"
                        className="size-5"
                    >
                        <Square className="size-2.5" />
                    </Button>
                }
            />

            {/* Grid */}
            <div className="flex-1 overflow-auto">
                {tracks.length === 0 ? (
                    <div className="flex min-h-full items-center justify-center p-6">
                        <DawEmptyState
                            title="No session tracks yet"
                            description="Add a track to start launching clips and scenes from the grid."
                            className="max-w-sm"
                        />
                    </div>
                ) : (
                    <div className="flex min-w-max">
                        <DawSideRail className="w-10">
                            <DawGridHeaderCell className="h-6 text-[10px] uppercase tracking-wider text-muted-foreground">
                                Scene
                            </DawGridHeaderCell>
                            {Array.from({ length: SCENE_COUNT }, (_, i) => (
                                <button
                                    type="button"
                                    key={i}
                                    className="h-10 cursor-pointer border-b border-border-hairline shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-colors hover:bg-surface-raised"
                                    onClick={() => handleLaunchScene(i)}
                                    aria-label={`Launch scene ${i + 1}`}
                                >
                                    <div className="flex h-full items-center justify-center">
                                        <Play className="size-3 text-muted-foreground transition-colors hover:text-foreground" />
                                    </div>
                                </button>
                            ))}
                        </DawSideRail>

                        {tracks.map((track: Track) => (
                            <div key={track.id} className="flex w-24 shrink-0 flex-col border-r border-border-hairline">
                                <DawGridHeaderCell
                                    className="h-6 truncate px-1"
                                    accentColor={track.color ?? undefined}
                                    title={track.name}
                                >
                                    {track.name}
                                </DawGridHeaderCell>

                                {Array.from({ length: SCENE_COUNT }, (_, sceneIndex) => {
                                    const clipId = getClipForSlot(track.id, sceneIndex);
                                    const isActive = activeSlots.get(track.id) === sceneIndex;

                                    return (
                                        <div
                                            key={sceneIndex}
                                            className={cn(
                                                'flex h-10 cursor-pointer items-center justify-center border-b border-border-hairline transition-colors',
                                                clipId
                                                    ? isActive
                                                        ? 'bg-[var(--color-state-play)]/20 shadow-[inset_0_0_8px_color-mix(in_oklch,var(--color-state-play)_10%,transparent)]'
                                                        : 'bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] hover:bg-surface-raised'
                                                    : 'hover:bg-white/[0.03]'
                                            )}
                                            onClick={() => {
                                                if (clipId) {
                                                    handleLaunchSlot(track.id, sceneIndex);
                                                }
                                            }}
                                            role="gridcell"
                                            aria-label={`${track.name} scene ${sceneIndex + 1}${clipId ? ' - clip loaded' : ' - empty'}`}
                                        >
                                            {clipId ? (
                                                <div className="flex items-center gap-1">
                                                    {isActive ? (
                                                        <Play className="size-2.5 fill-[var(--color-state-play)] text-[var(--color-state-play)]" />
                                                    ) : null}
                                                    <span
                                                        className={cn(
                                                            'rounded px-1 py-0.5 text-[10px]',
                                                            isActive
                                                                ? 'bg-[var(--color-state-play)]/30 text-[var(--color-state-play)]'
                                                                : 'bg-muted/30 text-muted-foreground'
                                                        )}
                                                        style={{
                                                            backgroundColor: isActive
                                                                ? undefined
                                                                : track.color
                                                                  ? `${track.color}20`
                                                                  : undefined,
                                                        }}
                                                    >
                                                        Clip
                                                    </span>
                                                </div>
                                            ) : (
                                                <Plus className="size-2.5 text-muted-foreground/30" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

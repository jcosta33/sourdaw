/**
 * Session / Clip Launcher View.
 * Ableton-style vertical grid of clip slots with scene triggers.
 * Each track has a column of clip slots; each row is a scene.
 */
import { type ReactElement, useState } from 'react';
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
            {/* Header */}
            <div
                className="flex items-center gap-2 px-3 py-1.5 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                    border: '1px solid rgba(0,0,0,0.4)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Session</span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleStopAll}
                    aria-label="Stop all clips"
                    className="size-5"
                >
                    <Square className="size-2.5" />
                </Button>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-auto">
                <div className="flex min-w-max">
                    {/* Scene triggers column */}
                    <div className="flex flex-col w-10 shrink-0 border-r border-border-soft shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)]" style={{ background: 'linear-gradient(180deg, #0a0a0a 0%, #0e0e0e 100%)' }}>
                        <div
                            className="h-6 flex items-center justify-center text-[10px] text-muted-foreground uppercase tracking-wider"
                            style={{
                                borderBottom: '1px solid transparent',
                                backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2))',
                                backgroundSize: '100% 1px',
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'bottom',
                            }}
                        >
                            Scene
                        </div>
                        {Array.from({ length: SCENE_COUNT }, (_, i) => (
                            <button
                                type="button"
                                key={i}
                                className="h-10 flex items-center justify-center border-b border-border-hairline hover:bg-surface-raised transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] cursor-pointer"
                                onClick={() => handleLaunchScene(i)}
                                aria-label={`Launch scene ${i + 1}`}
                            >
                                <Play className="size-3 text-muted-foreground hover:text-foreground" />
                            </button>
                        ))}
                    </div>

                    {/* Track columns */}
                    {tracks.map((track: Track) => (
                        <div key={track.id} className="flex flex-col w-24 shrink-0 border-r border-border-hairline">
                            {/* Track header */}
                            <div
                                className="h-6 flex items-center justify-center text-[10px] font-medium text-foreground border-b border-border-hairline bg-surface-tray truncate px-1"
                                style={{ borderTopColor: track.color, borderTopWidth: track.color ? 2 : 0 }}
                            >
                                {track.name}
                            </div>

                            {/* Clip slots */}
                            {Array.from({ length: SCENE_COUNT }, (_, sceneIndex) => {
                                const clipId = getClipForSlot(track.id, sceneIndex);
                                const isActive = activeSlots.get(track.id) === sceneIndex;

                                return (
                                    <div
                                        key={sceneIndex}
                                        className={cn(
                                            'h-10 flex items-center justify-center border-b border-border-hairline transition-colors cursor-pointer',
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
                                                    <Play className="size-2.5 text-[var(--color-state-play)] fill-[var(--color-state-play)]" />
                                                ) : null}
                                                <span
                                                    className={cn(
                                                        'text-[10px] rounded px-1 py-0.5',
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
            </div>
        </div>
    );
};

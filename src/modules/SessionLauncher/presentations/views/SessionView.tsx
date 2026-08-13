/**
 * Session / Clip Launcher View.
 * Ableton-style vertical grid of clip slots with scene triggers.
 * Each track has a column of clip slots; each row is a scene.
 */
import { type ReactElement } from 'react';

import { Play, Square, Plus } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawGridHeaderCell } from '#/components/daw/DawGridHeaderCell';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPanelSurface } from '#/components/daw/DawPanelSurface';
import { DawSideRail } from '#/components/daw/DawSideRail';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../models/TrackViewTypes';
import { sessionLaunchStore, type SessionLaunchState } from '../../stores/sessionLaunchStore';
import { launchSessionScene } from '../../useCases/sessionLaunch/launchSessionScene';
import { stopAllSessionSlots } from '../../useCases/sessionLaunch/stopAllSessionSlots';
import { toggleSessionSlot } from '../../useCases/sessionLaunch/toggleSessionSlot';
import { useTracks } from '../hooks/useTracks';

const SCENE_COUNT = 8;
const emptyState: SessionLaunchState = { activeSlots: {} };

export const SessionView = (): ReactElement => {
    const { tracks } = useTracks();
    // §83.2 — state lives in a module-level store so panel close/reopen
    // no longer discards which clips are launched.
    const state = useStore(sessionLaunchStore, emptyState);
    const activeSlots = state.activeSlots;

    const handleLaunchSlot = (trackId: string, sceneIndex: number): void => {
        toggleSessionSlot(trackId, sceneIndex);
    };

    const handleLaunchScene = (sceneIndex: number): void => {
        launchSessionScene(
            tracks.map((time) => time.id),
            sceneIndex
        );
    };

    const handleStopAll = (): void => {
        stopAllSessionSlots();
    };

    // §142.1 — pre-compute the clip-per-slot map once per track during the
    // outer tracks.map rather than re-scanning `tracks` inside the scene
    // inner loop. The previous getClipForSlot(trackId, sceneIndex) did a
    // full tracks.find() per rendered cell → O(tracks × scenes × tracks).
    const renderIife_7 = () => {
        if (tracks.length === 0) {
            return (
                <div className="flex min-h-full items-center justify-center p-6">
                    <DawEmptyState
                        title="No session tracks yet"
                        description="Add a track to start launching clips and scenes from the grid."
                        className="max-w-sm"
                    />
                </div>
            );
        } else {
            return (
                <div className="flex min-w-max">
                    <DawSideRail className="w-10">
                        <DawGridHeaderCell className="h-6 text-[10px] uppercase tracking-wider text-muted-foreground">
                            Scene
                        </DawGridHeaderCell>
                        {Array.from({ length: SCENE_COUNT }, (_, index) => (
                            <button
                                type="button"
                                key={index}
                                className="h-10 cursor-pointer border-b border-border-hairline shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-colors hover:bg-surface-raised"
                                onClick={() => handleLaunchScene(index)}
                                aria-label={`Launch scene ${index + 1}`}
                            >
                                <div className="flex h-full items-center justify-center">
                                    <Play className="size-3 text-muted-foreground transition-colors hover:text-foreground" />
                                </div>
                            </button>
                        ))}
                    </DawSideRail>
                    {tracks.map((track: Track) => {
                        const trackClipIds: Array<string | null> = Array.from(
                            { length: SCENE_COUNT },
                            (_, index) => track.clips[index]?.id ?? null
                        );

                        return (
                            <div key={track.id} className="flex w-24 shrink-0 flex-col border-r border-border-hairline">
                                <DawGridHeaderCell
                                    className="h-6 truncate px-1"
                                    accentColor={track.color ?? undefined}
                                    title={track.name}
                                >
                                    {track.name}
                                </DawGridHeaderCell>
                                {Array.from({ length: SCENE_COUNT }, (_, sceneIndex) => {
                                    const clipId = trackClipIds[sceneIndex] ?? null;
                                    const isActive = activeSlots[track.id] === sceneIndex;
                                    const renderIife_8 = () => {
                                        if (!clipId) {
                                            return 'hover:bg-white/[0.03]';
                                        }
                                        if (isActive) {
                                            return 'bg-[var(--color-state-play)]/20 shadow-[inset_0_0_8px_color-mix(in_oklch,var(--color-state-play)_10%,transparent)]';
                                        }
                                        return 'bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] hover:bg-surface-raised';
                                    };
                                    const renderIife_9 = () => {
                                        if (clipId) {
                                            const renderIife_10 = () => {
                                                if (isActive) {
                                                    return undefined;
                                                }
                                                if (track.color) {
                                                    return `${track.color}20`;
                                                }
                                                return undefined;
                                            };

                                            return (
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
                                                            backgroundColor: renderIife_10(),
                                                        }}
                                                    >
                                                        Clip
                                                    </span>
                                                </div>
                                            );
                                        } else {
                                            return <Plus className="size-2.5 text-muted-foreground/30" />;
                                        }
                                    };

                                    return (
                                        <button
                                            type="button"
                                            key={clipId ?? `empty-${sceneIndex}`}
                                            className={cn(
                                                'flex h-10 w-full cursor-pointer items-center justify-center border-b border-border-hairline transition-colors',
                                                renderIife_8()
                                            )}
                                            onClick={() => handleLaunchSlot(track.id, sceneIndex)}
                                            disabled={!clipId}
                                            aria-label={`${track.name} scene ${sceneIndex + 1}${clipId ? ' - clip loaded' : ' - empty'}`}
                                        >
                                            {renderIife_9()}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            );
        }
    };

    return (
        <DawPanelSurface>
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
            <div className="flex-1 overflow-auto">{renderIife_7()}</div>
        </DawPanelSurface>
    );
};

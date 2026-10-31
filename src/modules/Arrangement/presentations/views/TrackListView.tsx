import {
    type ReactElement,
    type CSSProperties,
    type DragEvent,
    type KeyboardEvent,
    useRef,
    useState,
    useLayoutEffect,
} from 'react';

import { Plus, FolderPlus, Rows3, Music, Mic2, GitBranch, FileStack, Wand2 } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMenuSectionLabel } from '#/components/daw/DawMenuParts';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '#/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { injectPromptDraft } from '#/modules/AiRuntime/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { isKeyboardEditableTarget } from '#/modules/CommandInterface/useCases';
import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { defaultPreferences, setTrackHeight } from '#/modules/Preferences/useCases';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { getVariationLaneCount, getVariationLaneExtent, VARIATION_LANE_HEIGHT } from '../../models/TimelineTrackExtent';
import { timelineViewStore, setScrollY } from '../../stores/timelineViewStore';
import { getTrackTemplates } from '../../useCases/getTrackTemplates';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../hooks/useTracks';

import { MiniMasterSpectrum } from './MiniMasterSpectrum';
import { TrackHeader } from './TrackHeader';

/**
 * Both columns scroll the same range when the header list ends with exactly the
 * strip the canvas lacks below it (scrollbar, scratch pad). Until the canvas
 * has reported a viewport there is nothing to measure against.
 */
function getHeaderSpacerHeight(scrollerHeight: number, canvasViewportHeight: number): number {
    if (canvasViewportHeight <= 0) {
        return 0;
    }
    return Math.max(0, scrollerHeight - canvasViewportHeight);
}

const HEIGHT_CYCLE: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];
const HEIGHT_LABELS: Record<Preferences['trackHeight'], string> = {
    compact: 'Compact',
    normal: 'Normal',
    large: 'Large',
};

export const TrackListView = ({
    style,
    extraHeaderHeight = 0,
}: {
    style?: CSSProperties;
    extraHeaderHeight?: number;
}): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragTrackIdRef = useRef<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isSyncingRef = useRef(false);
    const scrollRafRef = useRef<number | null>(null);
    const prefs = useStore(preferencesStore, defaultPreferences);
    const currentHeight = prefs.trackHeight;

    // Subscribe to scrollY alone — reading the whole TimelineViewState would
    // re-render this non-virtualised header tree on every pixelsPerBeat /
    // scrollX / autoScrollEnabled change.
    const scrollY = useStoreSelector(timelineViewStore, (state) => state?.scrollY ?? 0);
    const canvasViewportHeight = useStoreSelector(timelineViewStore, (state) => state?.viewportHeight ?? 0);
    const [scrollerHeight, setScrollerHeight] = useState(0);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        if (Math.abs(el.scrollTop - scrollY) > 1) {
            isSyncingRef.current = true;
            el.scrollTop = scrollY;
            requestAnimationFrame(() => {
                isSyncingRef.current = false;
            });
        }
    }, [scrollY]);

    // Coalesce native scroll events to one store write per animation frame so a
    // fast scroll doesn't dispatch setScrollY on every pixel.
    const handleScroll = () => {
        if (isSyncingRef.current) {
            return;
        }
        if (scrollRafRef.current !== null) {
            return;
        }
        scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            const el = scrollRef.current;
            if (!el) {
                return;
            }
            // The timeline canvas owns the store's viewport height; the spacer
            // gives this list the same scroll range, so scrollTop maps
            // straight onto the shared offset.
            setScrollY(el.scrollTop);
        });
    };

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return undefined;
        }
        setScrollerHeight(el.clientHeight);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setScrollerHeight(entry.contentRect.height);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, []);

    const collapsedFolders = new Set(
        tracks.filter((time) => time.kind === 'folder' && time.collapsed).map((time) => time.id)
    );
    const visibleTracks = tracks.filter((time) => {
        if (time.kind === 'master') {
            return false;
        }
        if (!time.parentId) {
            return true;
        }
        return !collapsedFolders.has(time.parentId);
    });

    const handleDragStart = (trackId: string) => {
        dragTrackIdRef.current = trackId;
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
        event.preventDefault();
        setDragOverIndex(index);
    };

    const handleDrop = (index: number) => {
        if (dragTrackIdRef.current) {
            const globalIndex = tracks.findIndex((time) => time.id === visibleTracks[index]?.id);
            if (globalIndex >= 0) {
                void executeUserAppAction({
                    type: 'reorderTrack',
                    payload: { trackId: dragTrackIdRef.current, newIndex: globalIndex },
                });
            }
        }
        dragTrackIdRef.current = null;
        setDragOverIndex(null);
    };

    const handleDragEnd = () => {
        dragTrackIdRef.current = null;
        setDragOverIndex(null);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // Keystrokes typed into an inline editor (track rename) bubble to
        // this container; they must edit text, not navigate or delete —
        // the same gate the global shortcut layer applies to itself.
        const target = event.target as HTMLElement;
        if (isKeyboardEditableTarget(target)) {
            return;
        }

        const currentIndex = visibleTracks.findIndex((time) => time.id === selectedTrackId);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (currentIndex < visibleTracks.length - 1) {
                selectTrack(visibleTracks[currentIndex + 1]!.id);
            } else if (currentIndex === -1 && visibleTracks.length > 0) {
                selectTrack(visibleTracks[0]!.id);
            }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (currentIndex > 0) {
                selectTrack(visibleTracks[currentIndex - 1]!.id);
            } else if (currentIndex === -1 && visibleTracks.length > 0) {
                selectTrack(visibleTracks[visibleTracks.length - 1]!.id);
            }
        } else if (event.key === 'Enter' && selectedTrackId) {
            event.preventDefault();
            // Claim the key: it would otherwise bubble to the window layer, where Enter also stops playback.
            event.stopPropagation();
            setWorkspaceMode('clip');
        }
    };

    const claimDestructiveKey = (event: KeyboardEvent<HTMLDivElement>) => {
        // The inline rename input sits inside this subtree too; its
        // keystrokes must edit text, not delete the track.
        const target = event.target as HTMLElement;
        if (isKeyboardEditableTarget(target)) {
            return;
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedTrackId) {
                // Claim the key for every selected case: this cuts the
                // bubble path to the window-level shortcut layer whenever
                // the track list owns the gesture — visible or not, and
                // whatever the confirmation below resolves to
                // (stopPropagation cannot be called after the await). The
                // confirmation opens only for a track the list can show,
                // so a selected-but-hidden track (master, child of a
                // collapsed folder) is a no-op rather than an unconfirmed
                // clip deletion. The handler sits on the outermost
                // element, so the header band beside the list is covered
                // as well as the rows.
                event.preventDefault();
                event.stopPropagation();
                const track = visibleTracks.find((time) => time.id === selectedTrackId);
                if (track) {
                    void (async () => {
                        const ok = await confirmUser({
                            title: `Delete "${track.name}"?`,
                            message: 'The track, its clips and its devices are removed. Undo restores them.',
                            confirmLabel: 'Delete',
                            variant: 'danger',
                        });
                        if (ok) {
                            // Same gesture as the context menu's Delete Track,
                            // so it takes the same undoable route: the bare
                            // `removeTrack` use case captures nothing for undo.
                            void executeUserAppAction({
                                type: 'removeTrack',
                                payload: { trackId: selectedTrackId },
                            });
                        }
                    })();
                }
            }
        }
    };

    return (
        <Stack
            shrink={false}
            className="h-full border-r border-border/30 bg-surface-well"
            style={style}
            data-onboarding="track-list"
            onKeyDown={claimDestructiveKey}
        >
            <DawHeaderBand
                className="group relative shrink-0 items-end px-2 pb-1 pt-2"
                style={{ height: extraHeaderHeight }}
                actions={
                    <Row
                        gap={0.5}
                        className="relative z-20 ml-auto opacity-80 transition-opacity group-hover:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Track height: ${HEIGHT_LABELS[currentHeight]}`}
                                    data-testid="track-height-cycle"
                                    onClick={() => {
                                        const idx = HEIGHT_CYCLE.indexOf(currentHeight);
                                        const next = HEIGHT_CYCLE[(idx + 1) % HEIGHT_CYCLE.length]!;
                                        setTrackHeight(next);
                                    }}
                                >
                                    <Rows3 className="size-3" aria-hidden="true" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Track height: {HEIGHT_LABELS[currentHeight]}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="Auto-organize with AI"
                                    onClick={() =>
                                        injectPromptDraft(
                                            'Auto-organize my project into color-coded instrument folders and standardized names.'
                                        )
                                    }
                                >
                                    <Wand2 className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Auto-organize with AI</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label="Add folder"
                                    data-testid="add-folder-button"
                                    onClick={() =>
                                        void executeUserAppAction({
                                            type: 'createFolder',
                                            payload: {
                                                name: `Folder ${tracks.filter((time) => time.kind === 'folder').length + 1}`,
                                            },
                                        })
                                    }
                                >
                                    <FolderPlus className="size-3" aria-hidden="true" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Add Folder</TooltipContent>
                        </Tooltip>
                        <AddTrackMenu trackCount={tracks.length} />
                    </Row>
                }
            >
                <MiniMasterSpectrum />
            </DawHeaderBand>
            <div
                ref={scrollRef}
                className="min-h-0 flex-[1_1_0px] overflow-y-auto overflow-x-hidden"
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
            >
                <div role="grid" aria-label="Track list">
                    {visibleTracks.map((track, index) => {
                        return (
                            <div
                                key={track.id}
                                role="row"
                                tabIndex={track.id === selectedTrackId ? 0 : -1}
                                aria-selected={track.id === selectedTrackId}
                                draggable
                                onDragStart={(event) => {
                                    event.dataTransfer.setData('text/plain', track.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                    handleDragStart(track.id);
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = 'move';
                                    handleDragOver(event, index);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    handleDrop(index);
                                }}
                                onDragEnd={handleDragEnd}
                                onClick={() => selectTrack(track.id)}
                                className={
                                    dragOverIndex === index
                                        ? 'border-t-2 border-ring outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70'
                                        : 'outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70'
                                }
                            >
                                <TrackHeader track={track} isSelected={track.id === selectedTrackId} />
                                {getVariationLaneCount(track) > 0 ? (
                                    <div
                                        data-testid={`variation-lanes-${track.id}`}
                                        style={{ height: getVariationLaneExtent(track) }}
                                    >
                                        {track.alternatives.map((alternative) => (
                                            <div
                                                key={alternative.id}
                                                data-testid="variation-lane-row"
                                                className="box-border flex items-center overflow-hidden border-t border-border/20 bg-surface-well/60 px-3 text-[10px] text-muted-foreground"
                                                style={{ height: VARIATION_LANE_HEIGHT }}
                                            >
                                                <span className="truncate">{alternative.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}

                    {tracks.length === 0 ? (
                        <div className="p-4">
                            <DawEmptyState
                                compact
                                title="No tracks yet"
                                description='Click + to add a track, or type "add audio track".'
                            />
                        </div>
                    ) : null}
                </div>
                <div
                    aria-hidden="true"
                    data-testid="track-list-scrollbar-spacer"
                    className="shrink-0"
                    style={{ height: getHeaderSpacerHeight(scrollerHeight, canvasViewportHeight) }}
                />
            </div>
        </Stack>
    );
};

const AddTrackMenu = ({ trackCount }: { trackCount: number }): ReactElement => {
    const createTrackOfKind = (kind: 'audio' | 'midi' | 'bus') => {
        const labels = { audio: 'Audio', midi: 'MIDI', bus: 'Bus' };
        // The undoable `addTrack` action, not the bare use case: the use case
        // captures no inverse (issue #3696), so a menu-created track left no
        // history. The handler's `discardCreatedTrack` inverse removes
        // precisely the created track and redo restores its id.
        void executeUserAppAction({
            type: 'addTrack',
            payload: { name: `${labels[kind]} ${trackCount + 1}`, kind },
        });
    };

    const templates = getTrackTemplates();

    return (
        <div data-testid="add-track-button">
            <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" aria-label="Add track">
                                <Plus className="size-3" aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Add Track</TooltipContent>
                </Tooltip>

                <DropdownMenuContent align="end" sideOffset={4} className="w-44">
                    <DropdownMenuItem
                        onClick={() => createTrackOfKind('audio')}
                        data-testid="add-track-audio"
                        className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer"
                    >
                        <Mic2 className="size-3 text-[var(--color-accent-cyan)]" />
                        Audio Track
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => createTrackOfKind('midi')}
                        data-testid="add-track-midi"
                        className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer"
                    >
                        <Music className="size-3 text-[var(--color-accent-mint)]" />
                        MIDI Track
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => createTrackOfKind('bus')}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer"
                    >
                        <GitBranch className="size-3 text-[var(--color-accent-peach)]" />
                        Bus Track
                    </DropdownMenuItem>
                    {templates.length > 0 ? (
                        <>
                            <DropdownMenuSeparator className="border-border/50" />
                            <DawMenuSectionLabel>Templates</DawMenuSectionLabel>
                            {templates.map((tmpl) => (
                                <DropdownMenuItem
                                    key={tmpl.id}
                                    onClick={() =>
                                        void executeUserAppAction({
                                            type: 'loadTrackTemplate',
                                            payload: { templateId: tmpl.id },
                                        })
                                    }
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer"
                                >
                                    <FileStack className="size-3 text-[var(--color-accent-lavender)]" />
                                    {tmpl.name}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

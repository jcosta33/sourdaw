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
import { injectPromptCommand } from '#/modules/AiRuntime/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { preferencesStore, type Preferences } from '#/modules/Preferences/stores';
import { defaultPreferences, setTrackHeight } from '#/modules/Preferences/useCases';
import { setWorkspaceMode } from '#/modules/WorkspaceShell/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { timelineViewStore, setScrollY, setTimelineViewportHeight } from '../../stores/timelineViewStore';
import { addTrack } from '../../useCases/addTrack';
import { createFolder } from '../../useCases/folder/createFolder';
import { getTrackTemplates } from '../../useCases/getTrackTemplates';
import { loadTrackTemplate } from '../../useCases/loadTrackTemplate';
import { reorderTrack } from '../../useCases/toggleTrackState/reorderTrack';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../hooks/useTracks';

import { MiniMasterSpectrum } from './MiniMasterSpectrum';
import { TakeLanePanel } from './TakeLanesView';
import { TrackHeader } from './TrackHeader';

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
            // Report this container's real height before clamping — it is the
            // canonical scrollable track-list viewport.
            setTimelineViewportHeight(el.clientHeight);
            setScrollY(el.scrollTop);
        });
    };

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
                reorderTrack(dragTrackIdRef.current, globalIndex);
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
            setWorkspaceMode('clip');
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
            if (selectedTrackId) {
                event.preventDefault();
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
                            void executeAppAction({
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
                                        injectPromptCommand(
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
                                        createFolder(
                                            `Folder ${tracks.filter((time) => time.kind === 'folder').length + 1}`
                                        )
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
                className="flex-1 overflow-y-auto overflow-x-hidden"
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
                                    dragOverIndex === index ? 'border-t-2 border-ring outline-none' : 'outline-none'
                                }
                            >
                                <TrackHeader track={track} isSelected={track.id === selectedTrackId} />
                                {track.showVariationLanes === true &&
                                track.kind !== 'folder' &&
                                track.kind !== 'master' ? (
                                    <TakeLanePanel trackId={track.id} trackName={track.name} trackColor={track.color} />
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
            </div>
        </Stack>
    );
};

const AddTrackMenu = ({ trackCount }: { trackCount: number }): ReactElement => {
    const createTrackOfKind = (kind: 'audio' | 'midi' | 'bus') => {
        const labels = { audio: 'Audio', midi: 'MIDI', bus: 'Bus' };
        addTrack({ name: `${labels[kind]} ${trackCount + 1}`, kind });
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
                                    onClick={() => loadTrackTemplate(tmpl.id)}
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

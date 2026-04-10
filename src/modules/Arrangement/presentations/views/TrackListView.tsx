import {
    type ReactElement,
    type CSSProperties,
    type DragEvent,
    type KeyboardEvent,
    useRef,
    useState,
    useLayoutEffect,
} from 'react';
import { useStore } from '#/infra/store/useStore';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '#/components/ui/dropdown-menu';
import { DawMenuSectionLabel } from '#/components/daw/DawMenuParts';
import { getTrackTemplates, loadTrackTemplate } from '../../useCases/trackTemplate';
import { Button } from '#/components/ui/button';
import { Plus, FolderPlus, Rows3, Music, Mic2, GitBranch, FileStack, Wand2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useTracks } from '../hooks/useTracks';
import { TrackHeader } from './TrackHeader';
import { addTrack } from '../../useCases/addTrack';
import { createFolder } from '../../useCases/folder';
import { reorderTrack } from '../../useCases/toggleTrackState/reorderTrack';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { removeTrack } from '../../useCases/removeTrack';
import {
    preferencesStore,
    defaultPreferences,
    type Preferences,
    setTrackHeight,
    setWorkspaceMode,
} from '#/modules/Workspace';
import { timelineViewStore, setScrollY, type TimelineViewState } from '../../stores/timelineViewStore';
import { injectPromptCommand } from '#/modules/AiRuntime';
import { MiniMasterSpectrum } from './MiniMasterSpectrum';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawEmptyState } from '#/components/daw/DawEmptyState';

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
    const prefs = useStore(preferencesStore, defaultPreferences);
    const currentHeight = prefs.trackHeight;

    const defaultTimelineView: TimelineViewState = {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    };
    const timelineView = useStore(timelineViewStore, defaultTimelineView);
    const scrollY = timelineView.scrollY;

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

    const handleScroll = () => {
        if (isSyncingRef.current) {
            return;
        }
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        setScrollY(el.scrollTop);
    };

    const collapsedFolders = new Set(tracks.filter((t) => t.kind === 'folder' && t.collapsed).map((t) => t.id));
    const visibleTracks = tracks.filter((t) => {
        if (t.kind === 'master') {
            return false;
        }
        if (!t.parentId) {
            return true;
        }
        return !collapsedFolders.has(t.parentId);
    });

    const handleDragStart = (trackId: string) => {
        dragTrackIdRef.current = trackId;
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
        e.preventDefault();
        setDragOverIndex(index);
    };

    const handleDrop = (index: number) => {
        if (dragTrackIdRef.current) {
            const globalIndex = tracks.findIndex((t) => t.id === visibleTracks[index]?.id);
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

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const currentIndex = visibleTracks.findIndex((t) => t.id === selectedTrackId);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentIndex < visibleTracks.length - 1) {
                selectTrack(visibleTracks[currentIndex + 1]!.id);
            } else if (currentIndex === -1 && visibleTracks.length > 0) {
                selectTrack(visibleTracks[0]!.id);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentIndex > 0) {
                selectTrack(visibleTracks[currentIndex - 1]!.id);
            } else if (currentIndex === -1 && visibleTracks.length > 0) {
                selectTrack(visibleTracks[visibleTracks.length - 1]!.id);
            }
        } else if (e.key === 'Enter' && selectedTrackId) {
            e.preventDefault();
            setWorkspaceMode('clip');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedTrackId) {
                e.preventDefault();
                const track = visibleTracks.find((t) => t.id === selectedTrackId);
                if (track && window.confirm(`Delete track "${track.name}"?`)) {
                    removeTrack(selectedTrackId);
                }
            }
        }
    };

    return (
        <div className="flex h-full shrink-0 flex-col border-r border-border/30 bg-surface-well" style={style}>
            <DawHeaderBand
                className="group relative shrink-0 items-end px-2 pb-1 pt-2"
                style={{ height: extraHeaderHeight }}
                actions={
                    <div
                        className="relative z-20 ml-auto flex items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Track height: ${HEIGHT_LABELS[currentHeight]}`}
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
                                    onClick={() =>
                                        createFolder(`Folder ${tracks.filter((t) => t.kind === 'folder').length + 1}`)
                                    }
                                >
                                    <FolderPlus className="size-3" aria-hidden="true" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Add Folder</TooltipContent>
                        </Tooltip>
                        <AddTrackMenu trackCount={tracks.length} />
                    </div>
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
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('text/plain', track.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                    handleDragStart(track.id);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    handleDragOver(e, index);
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    handleDrop(index);
                                }}
                                onDragEnd={handleDragEnd}
                                onClick={() => selectTrack(track.id)}
                                className={
                                    dragOverIndex === index ? 'border-t-2 border-ring outline-none' : 'outline-none'
                                }
                            >
                                <TrackHeader track={track} isSelected={track.id === selectedTrackId} />
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
        </div>
    );
};

const AddTrackMenu = ({ trackCount }: { trackCount: number }): ReactElement => {
    const createTrackOfKind = (kind: 'audio' | 'midi' | 'bus') => {
        const labels = { audio: 'Audio', midi: 'MIDI', bus: 'Bus' };
        addTrack({ name: `${labels[kind]} ${trackCount + 1}`, kind });
    };

    const templates = getTrackTemplates();

    return (
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
                    className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer"
                >
                    <Mic2 className="size-3 text-[var(--color-accent-cyan)]" />
                    Audio Track
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() => createTrackOfKind('midi')}
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
                {templates.length > 0 && (
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
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

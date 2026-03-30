import {
    type ReactElement,
    type CSSProperties,
    type DragEvent,
    type KeyboardEvent,
    useRef,
    useState,
    useEffect,
    useSyncExternalStore,
} from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
} from '#/components/ui/dropdown-menu';
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
import { setWorkspaceMode } from '../../useCases/trackViewActions';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { timelineViewStore, setScrollY } from '#/modules/Arrangement/stores/timelineViewStore';
import { injectPromptCommand } from '#/modules/AiRuntime/useCases/promptInjection';
import { defaultPreferences, type Preferences } from '#/modules/Workspace/useCases/workspaceQueries';
import { setTrackHeight } from '#/modules/Workspace/useCases/setTrackHeight';


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
    const prefs = useSyncExternalStore(
        (cb) => preferencesStore.subscribe(cb),
        () => preferencesStore.value ?? defaultPreferences
    );
    const currentHeight = prefs.trackHeight;



    const scrollY = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value?.scrollY ?? 0,
        () => 0
    );

    useEffect(() => {
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
            <div
                className="flex items-end justify-between border-b border-border/30 px-2 pb-1 pt-2 shrink-0"
                style={{
                    height: extraHeaderHeight,
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.03)',
                    border: '1px solid rgba(0,0,0,0.4)',
                    borderBottom: '1px solid rgba(40,40,40,0.3)',
                }}
            >
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Tracks
                </span>
                <div className="flex items-center gap-0.5">
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
            </div>

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
                                className={dragOverIndex === index ? 'border-t-2 border-ring outline-none' : 'outline-none'}
                            >
                                <TrackHeader
                                    track={track}
                                    isSelected={track.id === selectedTrackId}
                                />
                            </div>
                        );
                    })}

                    {tracks.length === 0 ? (
                        <div className="p-6 text-center">
                            <p className="text-xs text-muted-foreground">No tracks yet — time to start baking</p>
                            <p className="mt-1.5 text-[10px] text-muted-foreground/50">
                                Click + to add a track, or type &quot;add audio track&quot;
                            </p>
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
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Add track"
                        >
                            <Plus className="size-3" aria-hidden="true" />
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Add Track</TooltipContent>
            </Tooltip>

            <DropdownMenuContent
                align="end"
                sideOffset={4}
                className="w-44 rounded-md border border-border-soft border-t-[var(--color-light-edge)] bg-surface-overlay shadow-[0_4px_16px_rgba(0,0,0,0.5)] py-1"
            >
                <DropdownMenuItem onClick={() => createTrackOfKind('audio')} className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer">
                    <Mic2 className="size-3 text-[var(--color-accent-cyan)]" />
                    Audio Track
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => createTrackOfKind('midi')} className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer">
                    <Music className="size-3 text-[var(--color-accent-mint)]" />
                    MIDI Track
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => createTrackOfKind('bus')} className="flex items-center gap-2 px-3 py-1.5 text-xs focus:bg-white/[0.06] cursor-pointer">
                    <GitBranch className="size-3 text-[var(--color-accent-peach)]" />
                    Bus Track
                </DropdownMenuItem>
                {templates.length > 0 && (
                    <>
                        <DropdownMenuSeparator className="mx-2 my-1 border-border/30 bg-transparent border-t" />
                        <DropdownMenuLabel className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Templates
                        </DropdownMenuLabel>
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

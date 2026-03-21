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
import { Button } from '#/components/ui/button';
import { Plus, FolderPlus, Rows3, Music, Mic2, GitBranch, FileStack, Wand2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useTracks } from '../hooks/useTracks';
import { TrackHeader } from './TrackHeader';
import { addTrack } from '../../useCases/addTrack';
import { createFolder } from '../../useCases/folderUseCases';
import { reorderTrack, selectTrack } from '../../useCases/toggleTrackState';
import { removeTrack } from '../../useCases/removeTrack';
import { setWorkspaceMode } from '../../useCases/trackViewActions';
import { preferencesStore } from '#/modules/Workspace/stores/preferencesStore';
import { timelineViewStore, setScrollY } from '#/modules/Timeline/stores/timelineViewStore';
import { injectPromptCommand } from '#/modules/AiRuntime/presentations/views/VoiceCommandOverlay';
import { defaultPreferences, type Preferences } from '#/modules/Workspace/models/Preferences';

const HEIGHT_CYCLE: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];
const HEIGHT_LABELS: Record<Preferences['trackHeight'], string> = {
    compact: 'Compact',
    normal: 'Normal',
    large: 'Large',
};

export const TrackListView = ({ style, extraHeaderHeight = 0 }: { style?: CSSProperties; extraHeaderHeight?: number }): ReactElement => {
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
        if (t.kind === 'master') return false;
        if (!t.parentId) return true;
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
            <div className="flex items-center justify-between border-b border-border/30 px-2 py-1 shrink-0 bg-surface-tray" style={{ height: 50 + extraHeaderHeight }}>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tracks</span>
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
                                    if (prefs) {
                                        preferencesStore.set({ ...prefs, trackHeight: next });
                                    }
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
                                <Wand2 className="size-3 text-purple-400" aria-hidden="true" />
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
                    {visibleTracks.map((track, index) => (
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
                            <TrackHeader track={track} isSelected={track.id === selectedTrackId} />
                        </div>
                    ))}

                    {tracks.length === 0 && (
                        <div className="p-3 text-center">
                            <p className="text-xs text-muted-foreground">No tracks yet</p>
                            <p className="mt-1 text-[10px] text-muted-foreground/60">
                                Click + or type &quot;add audio track&quot;
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

import { getTrackTemplates, loadTrackTemplate } from '../../useCases/trackTemplateUseCases';

const AddTrackMenu = ({ trackCount }: { trackCount: number }): ReactElement => {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    const createTrackOfKind = (kind: 'audio' | 'midi' | 'bus') => {
        const labels = { audio: 'Audio', midi: 'MIDI', bus: 'Bus' };
        addTrack({ name: `${labels[kind]} ${trackCount + 1}`, kind });
        setOpen(false);
    };

    const templates = open ? getTrackTemplates() : [];

    return (
        <div className="relative" ref={menuRef}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Add track"
                        aria-haspopup="true"
                        aria-expanded={open}
                        onClick={() => setOpen((v) => !v)}
                    >
                        <Plus className="size-3" aria-hidden="true" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Add Track</TooltipContent>
            </Tooltip>

            {open && (
                <div
                    className="absolute top-full right-0 z-50 mt-1 w-44 rounded-md border border-border bg-surface-overlay shadow-lg py-1 animate-in fade-in-0 zoom-in-95"
                    role="menu"
                >
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                        role="menuitem"
                        onClick={() => createTrackOfKind('audio')}
                    >
                        <Mic2 className="size-3 text-blue-400" />
                        Audio Track
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                        role="menuitem"
                        onClick={() => createTrackOfKind('midi')}
                    >
                        <Music className="size-3 text-green-400" />
                        MIDI Track
                    </button>
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                        role="menuitem"
                        onClick={() => createTrackOfKind('bus')}
                    >
                        <GitBranch className="size-3 text-orange-400" />
                        Bus Track
                    </button>
                    {templates.length > 0 && (
                        <>
                            <div className="mx-2 my-1 border-t border-border/30" />
                            <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Templates
                            </p>
                            {templates.map((tmpl) => (
                                <button
                                    type="button"
                                    key={tmpl.id}
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                                    role="menuitem"
                                    onClick={() => {
                                        loadTrackTemplate(tmpl.id);
                                        setOpen(false);
                                    }}
                                >
                                    <FileStack className="size-3 text-purple-400" />
                                    {tmpl.name}
                                </button>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

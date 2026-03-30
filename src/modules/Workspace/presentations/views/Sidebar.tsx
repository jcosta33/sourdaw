import { type CSSProperties, type ReactElement, useState, useRef, useEffect, useCallback } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Search, Music, FileAudio, Waves, Upload, X, Zap, FolderSync } from 'lucide-react';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { toggleSidebar } from '../../useCases/togglePanel/panelToggles';
import { useTracks } from '../hooks/useTracks';
import { decodeAudioFile } from '#/modules/Arrangement/useCases/trackViewActions';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases/trackQueries';
import { usePreviewAudio } from '../hooks/usePreviewAudio';
import { SamplesTab } from './Sidebar/SamplesTab';
import { InstrumentsTab } from './Sidebar/InstrumentsTab';
import { ColorTab } from './Sidebar/ColorTab';
import { StageTab } from './Sidebar/StageTab';
import { OnlineSampleBrowser } from './Sidebar/OnlineSampleBrowser';
import { MacrosPanel } from './Sidebar/MacrosPanel';
import { LibraryBrowser } from '#/modules/SampleLibrary/presentations/views/LibraryBrowser';

export type SidebarRoute = {
    id: string;
    title: string;
    payload?: Record<string, any>;
    /** Optional icon component for the back bar */
    icon?: React.ComponentType<{ className?: string }>;
    /** Optional color class for the icon */
    iconColor?: string;
};

type UserSample = {
    id: string;
    name: string;
    category: string;
    duration: string;
    audioBufferId: string;
    durationSeconds: number;
};

type SidebarProps = {
    style?: CSSProperties;
};

/** User-imported samples only — no placeholder data */
const SAMPLE_LIBRARY: { id: string; name: string; category: string; duration: string }[] = [];

// ── Tab scroll bar with conditional chevrons ────────────────────────

const TAB_ITEMS: { id: 'instruments' | 'color' | 'stage' | 'library' | 'macros'; label: string; Icon: typeof Music }[] = [
    { id: 'instruments', label: 'Instruments', Icon: Music },
    { id: 'color', label: 'Color', Icon: Zap },
    { id: 'stage', label: 'Stage', Icon: Waves },
    { id: 'library', label: 'Library', Icon: FileAudio },
    { id: 'macros', label: 'Macros', Icon: Zap },
];

const TabScrollBar = ({
    activeTab,
    onTabChange,
}: {
    activeTab: string;
    onTabChange: (tab: 'instruments' | 'color' | 'stage' | 'library' | 'macros') => void;
}): ReactElement => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollState = useCallback(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        const sl = el.scrollLeft;
        const overflow = el.scrollWidth - el.clientWidth;
        setCanScrollLeft(sl > 1);
        setCanScrollRight(overflow > 1 && sl < overflow - 1);
    }, []);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        // Delay initial check to after layout settles
        requestAnimationFrame(updateScrollState);
        el.addEventListener('scroll', updateScrollState, { passive: true });
        const ro = new ResizeObserver(() => requestAnimationFrame(updateScrollState));
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateScrollState);
            ro.disconnect();
        };
    }, [updateScrollState]);

    return (
        <div className="relative border-b border-border/20 shrink-0 bg-surface-base/80">
            <div
                ref={scrollRef}
                className="flex gap-0.5 overflow-x-auto scrollbar-none py-1.5 px-1 w-full"
            >
                {TAB_ITEMS.map(({ id, label, Icon }) => (
                    <Button
                        key={id}
                        variant={activeTab === id ? 'secondary' : 'ghost'}
                        size="xs"
                        className="shrink-0 gap-1 h-7 text-[10px] px-2"
                        onClick={() => onTabChange(id)}
                    >
                        <Icon className="size-3" /> {label}
                    </Button>
                ))}
            </div>

            {/* Chevrons overlaid, don't take space */}
            <button
                type="button"
                className={`absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center bg-gradient-to-r from-surface-base/90 to-transparent transition-opacity z-10 cursor-pointer ${
                    canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={() => scrollRef.current?.scrollBy({ left: -80, behavior: 'smooth' })}
                aria-label="Scroll tabs left"
                tabIndex={canScrollLeft ? 0 : -1}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button
                type="button"
                className={`absolute right-0 top-0 bottom-0 w-6 flex items-center justify-center bg-gradient-to-l from-surface-base/90 to-transparent transition-opacity z-10 cursor-pointer ${
                    canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={() => scrollRef.current?.scrollBy({ left: 80, behavior: 'smooth' })}
                aria-label="Scroll tabs right"
                tabIndex={canScrollRight ? 0 : -1}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="m9 18 6-6-6-6" /></svg>
            </button>
        </div>
    );
};

export const Sidebar = ({ style }: SidebarProps): ReactElement => {
    const [activeTab, setActiveTab] = useState<'library' | 'instruments' | 'color' | 'stage' | 'macros'>('instruments');
    const [libSubTab, setLibSubTab] = useState<'mine' | 'find' | 'folders'>('folders');
    const [navStacks, setNavStacks] = useState<Record<string, SidebarRoute[]>>({
        library: [{ id: 'library', title: 'Library' }],
        instruments: [{ id: 'instruments', title: 'Instruments' }],
        color: [{ id: 'color', title: 'Color' }],
        stage: [{ id: 'stage', title: 'Stage' }],
        macros: [{ id: 'macros', title: 'Macros' }],
    });

    const currentStack = navStacks[activeTab] ?? [];
    const currentRoute = currentStack[currentStack.length - 1] as SidebarRoute;

    const pushRoute = (route: SidebarRoute) => {
        setNavStacks((prev) => ({
            ...prev,
            [activeTab]: [...(prev[activeTab] ?? []), route],
        }));
    };

    const popRoute = () => {
        setNavStacks((prev) => {
            const stack = prev[activeTab] ?? [];
            if (stack.length > 1) {
                return { ...prev, [activeTab]: stack.slice(0, -1) };
            }
            return prev;
        });
    };

    const [searchQuery, setSearchQuery] = useState('');
    const [userSamples, setUserSamples] = useState<UserSample[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem('sourdaw-favorites');
            return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
        } catch {
            return new Set();
        }
    });
    const { tracks, selectedTrackId } = useTracks();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const preview = usePreviewAudio();

    const handleFileImport = async (files: FileList | null) => {
        if (!files) {
            return;
        }
        for (const file of Array.from(files)) {
            const ext = file.name.toLowerCase().split('.').pop() ?? '';
            const isAudio =
                file.type.startsWith('audio/') ||
                ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'aiff', 'aif', 'webm'].includes(ext);
            if (!isAudio) {
                continue;
            }

            try {
                const { id: bufferId, buffer } = await decodeAudioFile(file);
                const name = file.name.replace(/\.[^.]+$/, '');
                setUserSamples((prev) => [
                    ...prev,
                    {
                        id: `user-${bufferId}`,
                        name,
                        category: 'Imported',
                        duration: `${buffer.duration.toFixed(1)}s`,
                        audioBufferId: bufferId,
                        durationSeconds: buffer.duration,
                    },
                ]);
            } catch {
                notifyUser(`Failed to import "${file.name}" — unsupported format or corrupt file`, 'error');
            }
        }
    };

    const toggleFavorite = (id: string) => {
        setFavorites((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            try {
                localStorage.setItem('sourdaw-favorites', JSON.stringify([...next]));
            } catch {
                /* ignore */
            }
            return next;
        });
    };

    const allSamples = [...SAMPLE_LIBRARY, ...userSamples];
    const filteredSamples = allSamples.filter(
        (s) =>
            !searchQuery.trim() ||
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredPlugins = getPlatformPlugins().filter(
        (p) => !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedTrack = selectedTrackId ? (tracks.find((t) => t.id === selectedTrackId) ?? null) : null;

    return (
        <aside
            className="contain-strict flex shrink-0 flex-col border-r border-border-hairline bg-surface-tray shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)]"
            style={style}
            aria-label="Browser panel"
        >
            <div className="flex items-center gap-1.5 border-b border-border/50 p-2 bg-surface-base px-3">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                <Input
                    type="search"
                    placeholder="Search library..."
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                    }}
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 px-1"
                    aria-label="Search browser"
                />
                <Button variant="ghost" size="icon-xs" onClick={toggleSidebar} aria-label="Close browser">
                    <X className="size-3.5" />
                </Button>
            </div>

            <TabScrollBar activeTab={activeTab} onTabChange={setActiveTab} />

            {currentStack.length > 1 ? (
                <div className="flex items-center gap-1 border-b border-border/50 bg-surface-overlay px-2 py-1.5 h-[34px] shrink-0">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={popRoute}
                        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-surface-raised"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m15 18-6-6 6-6" />
                        </svg>
                    </Button>
                    <span className="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground truncate ml-1 flex-1">
                        {currentRoute.title}
                    </span>
                    {currentRoute.icon ? (
                        <currentRoute.icon className={`size-3.5 shrink-0 ${currentRoute.iconColor ?? 'text-muted-foreground/50'}`} />
                    ) : null}
                </div>
            ) : null}

            <ScrollArea className="flex-1">
                <div
                    id={`browser-panel-${currentRoute.id}`}
                    className="p-1 h-full"
                    aria-label={`${currentRoute.title} browser`}
                >
                    {currentRoute.id === 'library' ? (
                        <>
                            {/* Sub-tabs: Folders | My Samples | Find Samples */}
                            <div className="flex gap-1 px-2 pb-2">
                                <Button
                                    variant={libSubTab === 'folders' ? 'secondary' : 'ghost'}
                                    size="xs"
                                    onClick={() => setLibSubTab('folders')}
                                    className="flex-1"
                                >
                                    <FolderSync className="size-3 mr-1" /> Folders
                                </Button>
                                <Button
                                    variant={libSubTab === 'mine' ? 'secondary' : 'ghost'}
                                    size="xs"
                                    onClick={() => setLibSubTab('mine')}
                                    className="flex-1"
                                >
                                    <FileAudio className="size-3 mr-1" /> Imported
                                </Button>
                                <Button
                                    variant={libSubTab === 'find' ? 'secondary' : 'ghost'}
                                    size="xs"
                                    onClick={() => setLibSubTab('find')}
                                    className="flex-1"
                                >
                                    <Search className="size-3 mr-1" /> Find
                                </Button>
                            </div>

                            {libSubTab === 'folders' ? (
                                <div className="px-1 flex-1 min-h-0">
                                    <LibraryBrowser
                                        preview={preview}
                                        selectedTrackId={selectedTrackId}
                                    />
                                </div>
                            ) : libSubTab === 'mine' ? (
                                <div className="px-2">
                                    <div className="flex items-center justify-between pb-1">
                                        <span className="text-[9px] text-muted-foreground">
                                            {filteredSamples.length} samples
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="h-5 gap-1 text-[10px]"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Upload className="size-3" aria-hidden="true" />
                                            Import
                                        </Button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a,.aiff,.aif"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                void handleFileImport(e.target.files);
                                                e.target.value = '';
                                            }}
                                        />
                                    </div>
                                    <SamplesTab
                                        samples={filteredSamples}
                                        favorites={favorites}
                                        onToggleFavorite={toggleFavorite}
                                        selectedTrackId={selectedTrackId}
                                        preview={preview}
                                    />
                                </div>
                            ) : (
                                <div className="px-2">
                                    <OnlineSampleBrowser preview={preview} />
                                </div>
                            )}
                        </>
                    ) : null}

                    {currentRoute.id.startsWith('instruments') ? (
                        <InstrumentsTab
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            selectedTrack={selectedTrack}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                            currentRoute={currentRoute}
                            pushRoute={pushRoute}
                        />
                    ) : null}

                    {currentRoute.id.startsWith('color') ? (
                        <ColorTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            currentRoute={currentRoute}
                            pushRoute={pushRoute}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                        />
                    ) : null}

                    {currentRoute.id.startsWith('stage') ? (
                        <StageTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            currentRoute={currentRoute}
                            pushRoute={pushRoute}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                        />
                    ) : null}

                    {activeTab === 'macros' ? <MacrosPanel /> : null}

                </div>
            </ScrollArea>
        </aside>
    );
};

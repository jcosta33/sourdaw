import { type CSSProperties, type ReactElement, useState, useRef } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Search, Music, FileAudio, Waves, Upload, X, Zap, FolderSync } from 'lucide-react';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { toggleSidebar } from '../../useCases/togglePanel/panelToggles';
import { useTracks } from '../hooks/useTracks';
import { decodeAudioFile } from '#/modules/Arrangement/useCases/trackViewActions';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases/getPlatformPlugins';
import { usePreviewAudio } from '../hooks/usePreviewAudio';
import { SamplesTab } from './Sidebar/SamplesTab';
import { InstrumentsTab } from './Sidebar/InstrumentsTab';
import { ColorTab } from './Sidebar/ColorTab';
import { StageTab } from './Sidebar/StageTab';
import { OnlineSampleBrowser } from './Sidebar/OnlineSampleBrowser';
import { MacrosPanel } from './Sidebar/MacrosPanel';
import { LibraryBrowser } from '#/modules/SampleLibrary/presentations/views/LibraryBrowser';
import { RailBackBar } from '../components/Sidebar/RailBackBar';
import { RailTabBar } from '../components/Sidebar/RailTabBar';

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

const TAB_ITEMS: { id: 'instruments' | 'color' | 'stage' | 'library' | 'macros'; label: string; Icon: typeof Music }[] =
    [
        { id: 'instruments', label: 'Instruments', Icon: Music },
        { id: 'color', label: 'Color', Icon: Zap },
        { id: 'stage', label: 'Stage', Icon: Waves },
        { id: 'library', label: 'Library', Icon: FileAudio },
        { id: 'macros', label: 'Macros', Icon: Zap },
    ];

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

            <RailTabBar
                activeId={activeTab}
                items={TAB_ITEMS.map(({ id, label, Icon }) => ({ id, label, icon: Icon }))}
                onChange={setActiveTab}
                className="border-b border-border/20 bg-surface-base/80"
                scrollerClassName="w-full px-1 py-1.5"
            />

            {currentStack.length > 1 ? (
                <RailBackBar
                    title={currentRoute.title}
                    onBack={popRoute}
                    icon={currentRoute.icon}
                    iconColor={currentRoute.iconColor}
                />
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
                            <RailTabBar
                                activeId={libSubTab}
                                items={[
                                    { id: 'folders', label: 'Folders', icon: FolderSync },
                                    { id: 'mine', label: 'Imported', icon: FileAudio },
                                    { id: 'find', label: 'Find', icon: Search },
                                ]}
                                onChange={setLibSubTab}
                                size="sub"
                                className="px-2 pb-2"
                                scrollerClassName="gap-1"
                                buttonClassName="min-w-[88px]"
                            />

                            {libSubTab === 'folders' ? (
                                <div className="px-1 flex-1 min-h-0">
                                    <LibraryBrowser preview={preview} selectedTrackId={selectedTrackId} />
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

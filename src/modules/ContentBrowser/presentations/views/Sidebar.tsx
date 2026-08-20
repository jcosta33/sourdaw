import { type CSSProperties, type ReactElement, useState, useRef } from 'react';

import { Search, Music, FileAudio, Waves, Upload, X, Zap, FolderSync, Settings } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { ScrollArea } from '#/components/ui/scroll-area';
import { getPlatformPlugins } from '#/modules/Arrangement/useCases';
import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { LibraryBrowser } from '#/modules/SampleLibrary/presentations/views';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { loadSidebarFavorites } from '../../useCases/sidebar-favorites/load-sidebar-favorites';
import { saveSidebarFavorites } from '../../useCases/sidebar-favorites/save-sidebar-favorites';
import { RailBackBar } from '../components/Sidebar/RailBackBar';
import { RailTabBar } from '../components/Sidebar/RailTabBar';
import { usePreviewAudio } from '../hooks/usePreviewAudio';
import { useTracks } from '../hooks/useTracks';

import { EffectsTab } from './Sidebar/EffectsTab';
import { InstrumentsTab } from './Sidebar/InstrumentsTab';
import { MacrosPanel } from './Sidebar/MacrosPanel';
import { OnlineSampleBrowser } from './Sidebar/OnlineSampleBrowser';
import { ProjectTab } from './Sidebar/ProjectTab';
import { SamplesTab } from './Sidebar/SamplesTab';
import { type SidebarRoute, type SidebarPanelActions } from './Sidebar/SidebarTypes';

export type { SidebarRoute, SidebarPanelActions };

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
    /** Close the browser panel. Owned by Workspace; injected by the composition shell. */
    onClose?: () => void;
    /** Device-panel emitters injected by the Workspace composition shell. */
    panelActions?: SidebarPanelActions;
};

/** User-imported samples only — no placeholder data */
const SAMPLE_LIBRARY: { id: string; name: string; category: string; duration: string }[] = [];

const TAB_ITEMS: {
    id: 'instruments' | 'effects' | 'library' | 'macros' | 'project';
    label: string;
    Icon: typeof Music;
}[] = [
    { id: 'instruments', label: 'Instruments', Icon: Music },
    { id: 'effects', label: 'Effects', Icon: Waves },
    { id: 'library', label: 'Library', Icon: FileAudio },
    { id: 'macros', label: 'Macros', Icon: Zap },
    { id: 'project', label: 'Project', Icon: Settings },
];

export const Sidebar = ({ style, onClose, panelActions }: SidebarProps): ReactElement => {
    const [activeTab, setActiveTab] = useState<'library' | 'instruments' | 'effects' | 'macros' | 'project'>(
        'instruments'
    );
    const [libSubTab, setLibSubTab] = useState<'mine' | 'find' | 'folders'>('folders');
    const [navStacks, setNavStacks] = useState<Record<string, SidebarRoute[]>>({
        library: [{ id: 'library', title: 'Library' }],
        instruments: [{ id: 'instruments', title: 'Instruments' }],
        effects: [{ id: 'effects', title: 'Effects' }],
        macros: [{ id: 'macros', title: 'Macros' }],
        project: [{ id: 'project', title: 'Project' }],
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
    const [favorites, setFavorites] = useState<Set<string>>(loadSidebarFavorites);
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
            saveSidebarFavorites(next);
            return next;
        });
    };

    const allSamples = [...SAMPLE_LIBRARY, ...userSamples];
    const filteredSamples = allSamples.filter(
        (state) =>
            !searchQuery.trim() ||
            state.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            state.category.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredPlugins = getPlatformPlugins().filter(
        (param) => !searchQuery.trim() || param.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedTrack = selectedTrackId ? (tracks.find((time) => time.id === selectedTrackId) ?? null) : null;
    const renderIife_11 = () => {
        if (currentRoute.id === 'library') {
            const renderIife_12 = () => {
                if (libSubTab === 'folders') {
                    return (
                        <div className="px-1 flex-1 min-h-0">
                            <LibraryBrowser preview={preview} selectedTrackId={selectedTrackId} />
                        </div>
                    );
                }
                if (libSubTab === 'mine') {
                    return (
                        <div className="px-2">
                            <Row justify="between" className="pb-1">
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
                                    onChange={(event) => {
                                        void handleFileImport(event.target.files);
                                        event.target.value = '';
                                    }}
                                />
                            </Row>
                            <SamplesTab
                                samples={filteredSamples}
                                favorites={favorites}
                                onToggleFavorite={toggleFavorite}
                                selectedTrackId={selectedTrackId}
                                preview={preview}
                            />
                        </div>
                    );
                }
                return (
                    <div className="px-2">
                        <OnlineSampleBrowser preview={preview} />
                    </div>
                );
            };

            return (
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
                    {renderIife_12()}
                </>
            );
        } else {
            return null;
        }
    };

    return (
        <Stack
            as="aside"
            shrink={false}
            className="contain-strict border-r border-border-hairline bg-surface-tray shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)]"
            style={style}
            aria-label="Browser panel"
        >
            <Row gap={1.5} className="border-b border-border/50 p-2 bg-surface-base px-3">
                <Search className="size-4 text-muted-foreground" aria-hidden="true" />
                <Input
                    type="search"
                    placeholder="Search library..."
                    value={searchQuery}
                    onChange={(event) => {
                        setSearchQuery(event.target.value);
                    }}
                    className="h-7 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0 px-1"
                    aria-label="Search browser"
                    data-testid="browser-search"
                />
                <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close browser">
                    <X className="size-3.5" />
                </Button>
            </Row>
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
                    {renderIife_11()}

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
                            panelActions={panelActions}
                        />
                    ) : null}

                    {currentRoute.id.startsWith('effects') ? (
                        <EffectsTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            currentRoute={currentRoute}
                            pushRoute={pushRoute}
                            panelActions={panelActions}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                        />
                    ) : null}

                    {activeTab === 'macros' ? <MacrosPanel /> : null}
                    {activeTab === 'project' ? <ProjectTab /> : null}
                </div>
            </ScrollArea>
        </Stack>
    );
};

import { type CSSProperties, type ReactElement, useState, useRef } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Search, Music, FileAudio, Waves, Upload, X } from 'lucide-react';
import { toggleSidebar } from '../../useCases/togglePanel';
import { BUILTIN_PLUGINS } from '../../useCases/workspaceViewActions';
import { useTracks } from '../hooks/useTracks';
import { decodeAudioFile } from '../../useCases/workspaceViewActions';
import { usePreviewAudio } from '../hooks/usePreviewAudio';
import { SamplesTab } from './sidebar/SamplesTab';
import { InstrumentsTab } from './sidebar/InstrumentsTab';
import { EffectsTab } from './sidebar/EffectsTab';

export type SidebarRoute = {
    id: string;
    title: string;
    payload?: Record<string, any>;
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

export const Sidebar = ({ style }: SidebarProps): ReactElement => {
    const [activeTab, setActiveTab] = useState<'library' | 'instruments' | 'effects'>('library');
    const [navStacks, setNavStacks] = useState<Record<string, SidebarRoute[]>>({
        library: [{ id: 'library', title: 'Library' }],
        instruments: [{ id: 'instruments', title: 'Instruments' }],
        effects: [{ id: 'effects', title: 'Audio Effects' }],
    });
    
    const currentStack = navStacks[activeTab] ?? [];
    const currentRoute = currentStack[currentStack.length - 1] as SidebarRoute;
    
    const pushRoute = (route: SidebarRoute) => {
        setNavStacks(prev => ({
            ...prev,
            [activeTab]: [...prev[activeTab] ?? [], route]
        }));
    };
    
    const popRoute = () => {
        setNavStacks(prev => {
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
            const stored = localStorage.getItem('webdaw-favorites');
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
                document.dispatchEvent(
                    new CustomEvent('webdaw:notify', {
                        detail: {
                            message: `Failed to import "${file.name}" — unsupported format or corrupt file`,
                            level: 'error',
                        },
                    })
                );
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
                localStorage.setItem('webdaw-favorites', JSON.stringify([...next]));
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

    const filteredPlugins = BUILTIN_PLUGINS.filter(
        (p) => !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedTrack = selectedTrackId ? (tracks.find((t) => t.id === selectedTrackId) ?? null) : null;

    return (
        <aside
            className="flex shrink-0 flex-col border-r border-border-hairline bg-[#0a0a0a] shadow-[inset_-1px_0_0_rgba(255,255,255,0.02)]"
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

            <div className="flex border-b border-border/20 p-2 gap-1 shrink-0 bg-surface-base/80">
                <Button 
                    variant={activeTab === 'library' ? 'secondary' : 'ghost'} 
                    size="xs" 
                    className="flex-1 gap-1.5 h-7 text-[10px]"
                    onClick={() => setActiveTab('library')}
                >
                    <FileAudio className="size-3" /> Library
                </Button>
                <Button 
                    variant={activeTab === 'instruments' ? 'secondary' : 'ghost'} 
                    size="xs" 
                    className="flex-1 gap-1.5 h-7 text-[10px]"
                    onClick={() => setActiveTab('instruments')}
                >
                    <Music className="size-3" /> Insts
                </Button>
                <Button 
                    variant={activeTab === 'effects' ? 'secondary' : 'ghost'} 
                    size="xs" 
                    className="flex-1 gap-1.5 h-7 text-[10px]"
                    onClick={() => setActiveTab('effects')}
                >
                    <Waves className="size-3" /> Effects
                </Button>
            </div>

            {currentStack.length > 1 && (
                <div className="flex items-center gap-1 border-b border-border/50 bg-surface-overlay px-2 py-1.5 h-[34px] shrink-0">
                    <Button variant="ghost" size="icon-xs" onClick={popRoute} className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground hover:bg-surface-raised">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                    </Button>
                    <span className="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground truncate ml-1">{currentRoute.title}</span>
                </div>
            )}
            
            <ScrollArea className="flex-1">
                <div
                    id={`browser-panel-${currentRoute.id}`}
                    className="p-1 h-full"
                    aria-label={`${currentRoute.title} browser`}
                >
                    {currentRoute.id === 'library' && (
                        <>
                            <div className="flex items-center justify-between px-1 pb-1">
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
                        </>
                    )}
                    
                    {currentRoute.id.startsWith('instruments') && (
                        <InstrumentsTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            selectedTrack={selectedTrack}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                            currentRoute={currentRoute}
                            pushRoute={pushRoute}
                        />
                    )}
                    
                    {currentRoute.id === 'effects' && (
                        <EffectsTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                        />
                    )}
                </div>
            </ScrollArea>
        </aside>
    );
};

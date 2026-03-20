import { type CSSProperties, type ReactElement, useState, useRef } from 'react';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Search, Music, FileAudio, Waves, Upload } from 'lucide-react';
import { cn } from '#/helpers/Styles/cn';
import { BUILTIN_PLUGINS } from '../../useCases/workspaceViewActions';
import { useTracks } from '../hooks/useTracks';
import { decodeAudioFile } from '../../useCases/workspaceViewActions';
import { usePreviewAudio } from '../hooks/usePreviewAudio';
import { SamplesTab } from './sidebar/SamplesTab';
import { InstrumentsTab } from './sidebar/InstrumentsTab';
import { EffectsTab } from './sidebar/EffectsTab';

type BrowserTab = 'samples' | 'instruments' | 'effects';

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

const TABS: { id: BrowserTab; label: string; Icon: typeof FileAudio }[] = [
    { id: 'samples', label: 'Samples', Icon: FileAudio },
    { id: 'instruments', label: 'Instruments', Icon: Music },
    { id: 'effects', label: 'Effects', Icon: Waves },
];

/** User-imported samples only — no placeholder data */
const SAMPLE_LIBRARY: { id: string; name: string; category: string; duration: string }[] = [];

export const Sidebar = ({ style }: SidebarProps): ReactElement => {
    const [activeTab, setActiveTab] = useState<BrowserTab>('samples');
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
            className="flex shrink-0 flex-col border-r border-border/50 bg-surface-raised"
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
            </div>

            <div className="flex border-b border-border/50 bg-surface-overlay" role="tablist" aria-label="Browser categories">
                {TABS.map((tab) => (
                    <Button
                        key={tab.id}
                        variant="ghost"
                        size="xs"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`browser-panel-${tab.id}`}
                        className={cn(
                            'flex-1 rounded-none border-b-2 transition-colors py-3 h-auto',
                            activeTab === tab.id
                                ? 'border-primary text-primary bg-surface-base'
                                : 'border-transparent text-muted-foreground hover:bg-surface-overlay hover:text-foreground'
                        )}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <tab.Icon className="size-4" aria-hidden="true" />
                    </Button>
                ))}
            </div>

            <ScrollArea className="flex-1">
                <div
                    id={`browser-panel-${activeTab}`}
                    role="tabpanel"
                    className="p-1"
                    aria-label={`${activeTab} browser`}
                >
                    {activeTab === 'samples' ? (
                        <>
                            <div className="flex items-center justify-between px-1 pb-1">
                                <span className="text-[9px] text-muted-foreground">
                                    {filteredSamples.length} samples
                                </span>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-5 gap-1 text-[10px]"
                                    onClick={() => {
                                        fileInputRef.current?.click();
                                    }}
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
                    ) : null}
                    {activeTab === 'instruments' ? (
                        <InstrumentsTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                            selectedTrack={selectedTrack}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                        />
                    ) : null}
                    {activeTab === 'effects' ? (
                        <EffectsTab
                            plugins={filteredPlugins}
                            selectedTrackId={selectedTrackId}
                            searchQuery={searchQuery}
                        />
                    ) : null}
                </div>
            </ScrollArea>
        </aside>
    );
};

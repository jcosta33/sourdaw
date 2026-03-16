import { type CSSProperties, type ReactElement, useState, useRef, useCallback } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import {
    Search, Music, Headphones, FileAudio, Star, Plus, Folder, File, Upload,
    ChevronDown, ChevronRight, Save, Trash2, Piano, Waves, X, Play, Square,
} from "lucide-react";
import { cn } from "#/helpers/Styles/cn";
import { BUILTIN_PLUGINS } from "#/modules/Track/models/DeviceParameter";
import { addDevice } from "#/modules/Track/useCases/deviceUseCases";
import { PluginBrowser } from "#/modules/AudioEngine/presentations/components/PluginBrowser";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { addClip } from "#/modules/Track/useCases/clipUseCases";
import { decodeAudioFile } from "#/modules/AudioEngine/useCases/decodeAudioFile";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import type { SoundPreset, SoundPresetCategory } from "#/modules/Track/models/SoundPreset";
import { getFactoryPresets } from "#/modules/Track/useCases/soundPresetLibrary";
import {
    createTrackFromPreset,
    loadPresetToTrack,
    getUserPresets,
    saveCurrentAsPreset,
    deleteUserPreset,
} from "#/modules/Track/useCases/presetUseCases";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { audioBufferCache } from "#/modules/AudioEngine/stores/audioBufferCache";

type BrowserTab = "samples" | "instruments" | "presets" | "favorites";

type UserSample = {
    id: string;
    name: string;
    category: string;
    duration: string;
    audioBufferId: string;
    durationSeconds: number;
};

const TABS: { id: BrowserTab; label: string; Icon: typeof FileAudio }[] = [
    { id: "samples", label: "Samples", Icon: FileAudio },
    { id: "instruments", label: "Instruments", Icon: Music },
    { id: "presets", label: "Presets", Icon: Headphones },
    { id: "favorites", label: "Favorites", Icon: Star },
];

const SAMPLE_LIBRARY = [
    { id: "kick-01", name: "Kick 01", category: "Drums", duration: "0.4s" },
    { id: "kick-02", name: "Kick 02", category: "Drums", duration: "0.3s" },
    { id: "snare-01", name: "Snare 01", category: "Drums", duration: "0.5s" },
    { id: "snare-02", name: "Snare 02", category: "Drums", duration: "0.4s" },
    { id: "hihat-closed", name: "Hi-Hat Closed", category: "Drums", duration: "0.2s" },
    { id: "hihat-open", name: "Hi-Hat Open", category: "Drums", duration: "0.6s" },
    { id: "clap-01", name: "Clap 01", category: "Drums", duration: "0.3s" },
    { id: "bass-loop-01", name: "Bass Loop 01", category: "Bass", duration: "4 bars" },
    { id: "bass-loop-02", name: "Bass Loop 02", category: "Bass", duration: "2 bars" },
    { id: "pad-ambient", name: "Ambient Pad", category: "Synth", duration: "8 bars" },
    { id: "pad-warm", name: "Warm Pad", category: "Synth", duration: "4 bars" },
    { id: "guitar-clean", name: "Clean Guitar", category: "Guitar", duration: "4 bars" },
    { id: "vocal-chop-01", name: "Vocal Chop 01", category: "Vocal", duration: "1 bar" },
    { id: "fx-riser-01", name: "Riser 01", category: "FX", duration: "2 bars" },
    { id: "fx-impact-01", name: "Impact 01", category: "FX", duration: "0.5s" },
    { id: "shaker-loop", name: "Shaker Loop", category: "Percussion", duration: "2 bars" },
];

const PRESET_CATEGORIES: SoundPresetCategory[] = [
    "synth", "bass", "pad", "lead", "keys", "drums", "fx", "vocal", "guitar", "strings",
];

const CATEGORY_COLORS: Record<SoundPresetCategory, string> = {
    synth: "bg-purple-500/20 text-purple-300",
    bass: "bg-red-500/20 text-red-300",
    pad: "bg-cyan-500/20 text-cyan-300",
    lead: "bg-yellow-500/20 text-yellow-300",
    keys: "bg-blue-500/20 text-blue-300",
    drums: "bg-orange-500/20 text-orange-300",
    fx: "bg-pink-500/20 text-pink-300",
    vocal: "bg-green-500/20 text-green-300",
    guitar: "bg-amber-500/20 text-amber-300",
    strings: "bg-indigo-500/20 text-indigo-300",
};

const usePreviewAudio = () => {
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    const [playingId, setPlayingId] = useState<string | null>(null);

    const stop = useCallback(() => {
        if (sourceRef.current) {
            try { sourceRef.current.stop(); } catch { /* already stopped */ }
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        setPlayingId(null);
    }, []);

    const play = useCallback((id: string, buffer: AudioBuffer) => {
        stop();

        const ctx = audioEngine.context;
        if (ctx.state === "suspended") {
            void ctx.resume();
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const gain = ctx.createGain();
        gain.gain.value = 0.7;
        source.connect(gain);
        gain.connect(ctx.destination);

        source.onended = () => {
            source.disconnect();
            gain.disconnect();
            if (sourceRef.current === source) {
                sourceRef.current = null;
                setPlayingId(null);
            }
        };

        sourceRef.current = source;
        setPlayingId(id);
        source.start();
    }, [stop]);

    const playTone = useCallback((id: string, frequency: number, durationSec: number) => {
        stop();

        const ctx = audioEngine.context;
        if (ctx.state === "suspended") {
            void ctx.resume();
        }

        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequency;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);

        osc.connect(gain);
        gain.connect(ctx.destination);

        const dummySource = ctx.createBufferSource();
        sourceRef.current = dummySource;
        setPlayingId(id);

        osc.start();
        osc.stop(ctx.currentTime + durationSec);

        osc.onended = () => {
            osc.disconnect();
            gain.disconnect();
            if (sourceRef.current === dummySource) {
                sourceRef.current = null;
                setPlayingId(null);
            }
        };
    }, [stop]);

    return { playingId, play, playTone, stop };
};

const PreviewButton = ({ isPlaying, onPlay, onStop }: {
    isPlaying: boolean;
    onPlay: () => void;
    onStop: () => void;
}): ReactElement => (
    <button
        className={cn(
            "size-4 shrink-0 flex items-center justify-center rounded transition-colors",
            isPlaying
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground/60 hover:text-foreground",
        )}
        onClick={(e) => {
            e.stopPropagation();
            if (isPlaying) { onStop(); }
            else { onPlay(); }
        }}
        aria-label={isPlaying ? "Stop preview" : "Preview sound"}
    >
        {isPlaying
            ? <Square className="size-2.5 fill-current" />
            : <Play className="size-2.5 fill-current" />
        }
    </button>
);

type SidebarProps = {
    style?: CSSProperties;
};

export const Sidebar = ({ style }: SidebarProps): ReactElement => {
    const [activeTab, setActiveTab] = useState<BrowserTab>("samples");
    const [searchQuery, setSearchQuery] = useState("");
    const [userSamples, setUserSamples] = useState<UserSample[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem("webdaw-favorites");
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
            const ext = file.name.toLowerCase().split(".").pop() ?? "";
            const isAudio = file.type.startsWith("audio/") ||
                ["wav", "mp3", "ogg", "flac", "aac", "m4a", "aiff", "aif", "webm"].includes(ext);
            if (!isAudio) {
                continue;
            }

            try {
                const { id: bufferId, buffer } = await decodeAudioFile(file);
                const name = file.name.replace(/\.[^.]+$/, "");
                setUserSamples((prev) => [...prev, {
                    id: `user-${bufferId}`,
                    name,
                    category: "Imported",
                    duration: `${buffer.duration.toFixed(1)}s`,
                    audioBufferId: bufferId,
                    durationSeconds: buffer.duration,
                }]);
            } catch {
                document.dispatchEvent(new CustomEvent("webdaw:notify", {
                    detail: { message: `Failed to import "${file.name}" — unsupported format or corrupt file`, level: "error" },
                }));
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
                localStorage.setItem("webdaw-favorites", JSON.stringify([...next]));
            } catch { /* ignore */ }
            return next;
        });
    };

    const allSamples = [...SAMPLE_LIBRARY, ...userSamples];
    const filteredSamples = allSamples.filter((s) =>
        !searchQuery.trim() || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.category.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const filteredPlugins = BUILTIN_PLUGINS.filter((p) =>
        !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const favoriteItems = [
        ...allSamples.filter((s) => favorites.has(s.id)),
    ];

    const selectedTrack = selectedTrackId
        ? tracks.find((t) => t.id === selectedTrackId) ?? null
        : null;

    return (
        <aside
            className="flex shrink-0 flex-col border-r border-border/50 bg-surface-raised"
            style={style}
            aria-label="Browser panel"
        >
            <div className="flex items-center gap-1 border-b border-border/50 p-2">
                <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                    type="search"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); }}
                    className="h-6 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                    aria-label="Search browser"
                />
            </div>

            <div className="flex border-b border-border/50" role="tablist" aria-label="Browser categories">
                {TABS.map((tab) => (
                    <Button
                        key={tab.id}
                        variant="ghost"
                        size="xs"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`browser-panel-${tab.id}`}
                        className={cn(
                            "flex-1 rounded-none",
                            activeTab === tab.id && "bg-accent",
                        )}
                        onClick={() => { setActiveTab(tab.id); }}
                    >
                        <tab.Icon className="size-3.5" aria-hidden="true" />
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
                    {activeTab === "samples" && (
                        <>
                            <div className="flex items-center justify-between px-1 pb-1">
                                <span className="text-[9px] text-muted-foreground">{filteredSamples.length} samples</span>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    className="h-5 gap-1 text-[10px]"
                                    onClick={() => { fileInputRef.current?.click(); }}
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
                                    onChange={(e) => { void handleFileImport(e.target.files); e.target.value = ""; }}
                                />
                            </div>
                            <SamplesTab samples={filteredSamples} favorites={favorites} onToggleFavorite={toggleFavorite} selectedTrackId={selectedTrackId} preview={preview} />
                        </>
                    )}
                    {activeTab === "instruments" && (
                        <InstrumentsTab plugins={filteredPlugins} selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                    )}
                    {activeTab === "presets" && (
                        <PresetsTab
                            searchQuery={searchQuery}
                            selectedTrackId={selectedTrackId}
                            selectedTrack={selectedTrack}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            preview={preview}
                        />
                    )}
                    {activeTab === "favorites" && (
                        <FavoritesTab items={favoriteItems} selectedTrackId={selectedTrackId} />
                    )}
                </div>
            </ScrollArea>
        </aside>
    );
};

// ---------------------------------------------------------------------------
// Samples Tab
// ---------------------------------------------------------------------------

type SampleItem = {
    id: string;
    name: string;
    category: string;
    duration: string;
    audioBufferId?: string;
    durationSeconds?: number;
};

type PreviewHandle = ReturnType<typeof usePreviewAudio>;

const SamplesTab = ({ samples, favorites, onToggleFavorite, selectedTrackId, preview }: {
    samples: SampleItem[];
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    selectedTrackId: string | null;
    preview: PreviewHandle;
}): ReactElement => {
    const categories = [...new Set(samples.map((s) => s.category))];

    const handleAdd = (sample: SampleItem) => {
        let trackId = selectedTrackId;
        if (!trackId) {
            const newTrack = addTrack({ name: sample.name, kind: "audio" });
            if (!newTrack) {
                return;
            }
            trackId = newTrack.id;
        }
        const durationBeats = sample.durationSeconds ? Math.max(1, Math.ceil(sample.durationSeconds * 2)) : 8;
        addClip({
            trackId,
            startBeat: 0,
            endBeat: durationBeats,
            name: sample.name,
            type: "audio",
            audioBufferId: sample.audioBufferId,
        });
    };

    return (
        <div className="space-y-2">
            {categories.map((cat) => (
                <div key={cat}>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <Folder className="size-3 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">{cat}</span>
                    </div>
                    {samples.filter((s) => s.category === cat).map((sample) => (
                        <div
                            key={sample.id}
                            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50 cursor-grab active:cursor-grabbing group"
                            draggable
                            onDragStart={(e) => {
                                const data = { name: sample.name, id: sample.id, duration: sample.duration, audioBufferId: sample.audioBufferId };
                                e.dataTransfer.setData("application/x-webdaw-sample", JSON.stringify(data));
                                e.dataTransfer.effectAllowed = "copy";
                            }}
                            onClick={() => { handleAdd(sample); }}
                            title="Drag to timeline or click to add"
                        >
                            <PreviewButton
                                isPlaying={preview.playingId === sample.id}
                                onPlay={() => {
                                    const buffer = sample.audioBufferId
                                        ? audioBufferCache.get(sample.audioBufferId)
                                        : undefined;
                                    if (buffer) {
                                        preview.play(sample.id, buffer);
                                    } else {
                                        preview.playTone(sample.id, 261.63, 0.5);
                                    }
                                }}
                                onStop={preview.stop}
                            />
                            <File className="size-3 text-muted-foreground" />
                            <span className="flex-1 text-xs text-foreground truncate">{sample.name}</span>
                            <span className="text-[9px] text-muted-foreground">{sample.duration}</span>
                            <button
                                className={cn("size-3 opacity-0 group-hover:opacity-100 transition-opacity", favorites.has(sample.id) && "opacity-100")}
                                onClick={(e) => { e.stopPropagation(); onToggleFavorite(sample.id); }}
                                aria-label={favorites.has(sample.id) ? "Remove from favorites" : "Add to favorites"}
                            >
                                <Star className={cn("size-3", favorites.has(sample.id) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")} />
                            </button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Instruments Tab
// ---------------------------------------------------------------------------

const InstrumentsTab = ({ plugins, selectedTrackId, searchQuery }: {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
}): ReactElement => {
    const showSynth = !searchQuery.trim() || "synth".includes(searchQuery.toLowerCase());

    const handleAddSynth = () => {
        const track = addTrack({ name: "Synth", kind: "midi" });
        if (!track) {
            return;
        }
        addDevice(track.id, "synth");
    };

    return (
        <div className="space-y-1">
            {showSynth && (
                <>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <Piano className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Instruments</span>
                    </div>
                    <div
                        className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer"
                        onClick={handleAddSynth}
                        title="Click to create a new MIDI track with Synth"
                    >
                        <div>
                            <span className="text-xs font-medium text-foreground">Synth</span>
                            <span className="ml-1 text-[9px] text-muted-foreground">instrument</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-purple-400">MIDI</span>
                            <Plus className="size-3 text-muted-foreground" />
                        </div>
                    </div>
                </>
            )}

            <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                <Waves className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Effects</span>
            </div>
            {plugins.map((plugin) => (
                <div
                    key={plugin.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent/50 cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-webdaw-plugin", JSON.stringify({ name: plugin.name, id: plugin.id }));
                        e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => { if (selectedTrackId) { addDevice(selectedTrackId, plugin.name); } }}
                    title="Drag to timeline or click to add to selected track"
                >
                    <div>
                        <span className="text-xs text-foreground">{plugin.name}</span>
                        <span className="ml-1 text-[9px] text-muted-foreground capitalize">{plugin.category}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[9px] text-muted-foreground">{plugin.parameters.length} params</span>
                        {selectedTrackId && <Plus className="size-3 text-muted-foreground" />}
                    </div>
                </div>
            ))}

            <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
        </div>
    );
};

// ---------------------------------------------------------------------------
// Presets Tab
// ---------------------------------------------------------------------------

type SelectedTrackInfo = {
    id: string;
    name: string;
    kind: string;
    devices: { type: string; name: string; parameterValues: Record<string, number> }[];
} | null;

const PresetsTab = ({ searchQuery, selectedTrackId, selectedTrack, favorites, onToggleFavorite, preview }: {
    searchQuery: string;
    selectedTrackId: string | null;
    selectedTrack: SelectedTrackInfo;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
}): ReactElement => {
    const [activeCategory, setActiveCategory] = useState<SoundPresetCategory | null>(null);
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ presetId: string; x: number; y: number } | null>(null);
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveFormName, setSaveFormName] = useState("");
    const [saveFormCategory, setSaveFormCategory] = useState<SoundPresetCategory>("synth");
    const [userPresetsVersion, setUserPresetsVersion] = useState(0);

    const factoryPresets = getFactoryPresets();
    const userPresets = getUserPresets();

    const query = searchQuery.toLowerCase().trim();

    const matchesSearch = (preset: SoundPreset): boolean => {
        if (!query) {
            return true;
        }
        return (
            preset.name.toLowerCase().includes(query) ||
            preset.category.toLowerCase().includes(query) ||
            preset.description.toLowerCase().includes(query) ||
            preset.tags.some((t) => t.toLowerCase().includes(query))
        );
    };

    const filteredFactory = factoryPresets.filter((p) => {
        if (activeCategory && p.category !== activeCategory) {
            return false;
        }
        return matchesSearch(p);
    });

    const filteredUser = userPresets.filter((p) => {
        if (activeCategory && p.category !== activeCategory) {
            return false;
        }
        return matchesSearch(p);
    });

    const categoriesWithPresets = PRESET_CATEGORIES.filter((cat) =>
        filteredFactory.some((p) => p.category === cat),
    );

    const toggleCategoryCollapse = (cat: string) => {
        setCollapsedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(cat)) {
                next.delete(cat);
            } else {
                next.add(cat);
            }
            return next;
        });
    };

    const handlePresetClick = (preset: SoundPreset) => {
        if (selectedTrackId) {
            loadPresetToTrack(selectedTrackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, presetId: string) => {
        e.preventDefault();
        setContextMenu({ presetId, x: e.clientX, y: e.clientY });
    };

    const handleDeleteUserPreset = (presetId: string) => {
        deleteUserPreset(presetId);
        setUserPresetsVersion((v) => v + 1);
        setContextMenu(null);
    };

    const handleSavePreset = () => {
        if (!selectedTrack || !saveFormName.trim()) {
            return;
        }
        saveCurrentAsPreset({
            name: saveFormName.trim(),
            category: saveFormCategory,
            trackKind: selectedTrack.kind === "midi" ? "midi" : "audio",
            devices: selectedTrack.devices.map((d) => ({
                type: d.type,
                name: d.name,
                parameterValues: d.parameterValues,
            })),
        });
        setSaveFormName("");
        setShowSaveForm(false);
        setUserPresetsVersion((v) => v + 1);
    };

    // Force re-read when user presets change
    void userPresetsVersion;

    return (
        <div
            className="space-y-1"
            onClick={() => { setContextMenu(null); }}
        >
            {/* Save Preset Button / Form */}
            {selectedTrack && (
                <div className="border-b border-border/30 pb-1.5 mb-1">
                    {!showSaveForm ? (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="w-full justify-start gap-1 text-[10px]"
                            onClick={() => { setShowSaveForm(true); }}
                        >
                            <Save className="size-3" aria-hidden="true" />
                            Save "{selectedTrack.name}" as Preset
                        </Button>
                    ) : (
                        <div className="space-y-1 px-1">
                            <div className="flex items-center gap-1">
                                <Input
                                    type="text"
                                    placeholder="Preset name…"
                                    value={saveFormName}
                                    onChange={(e) => { setSaveFormName(e.target.value); }}
                                    className="h-6 text-xs flex-1"
                                    onKeyDown={(e) => { if (e.key === "Enter") { handleSavePreset(); } }}
                                    autoFocus
                                />
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => { setShowSaveForm(false); setSaveFormName(""); }}
                                    aria-label="Cancel"
                                >
                                    <X className="size-3" />
                                </Button>
                            </div>
                            <div className="flex items-center gap-1">
                                <select
                                    value={saveFormCategory}
                                    onChange={(e) => { setSaveFormCategory(e.target.value as SoundPresetCategory); }}
                                    className="h-6 flex-1 rounded border border-border/50 bg-transparent text-[10px] text-foreground px-1"
                                >
                                    {PRESET_CATEGORIES.map((cat) => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                                <Button
                                    variant="default"
                                    size="xs"
                                    className="text-[10px]"
                                    onClick={handleSavePreset}
                                    disabled={!saveFormName.trim()}
                                >
                                    Save
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Category Filter Pills */}
            <div className="flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none">
                <button
                    className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors",
                        activeCategory === null
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50",
                    )}
                    onClick={() => { setActiveCategory(null); }}
                >
                    All
                </button>
                {PRESET_CATEGORIES.map((cat) => (
                    <button
                        key={cat}
                        className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium capitalize transition-colors",
                            activeCategory === cat
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50",
                        )}
                        onClick={() => { setActiveCategory(activeCategory === cat ? null : cat); }}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* User Presets Section */}
            {filteredUser.length > 0 && (
                <div>
                    <button
                        className="flex w-full items-center gap-1 px-1 py-0.5"
                        onClick={() => { toggleCategoryCollapse("__user__"); }}
                    >
                        {collapsedCategories.has("__user__")
                            ? <ChevronRight className="size-3 text-muted-foreground" />
                            : <ChevronDown className="size-3 text-muted-foreground" />
                        }
                        <Star className="size-3 text-yellow-400" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-yellow-400 uppercase">My Presets</span>
                        <span className="ml-auto text-[9px] text-muted-foreground">{filteredUser.length}</span>
                    </button>
                    {!collapsedCategories.has("__user__") && filteredUser.map((preset) => (
                        <PresetItem
                            key={preset.id}
                            preset={preset}
                            selectedTrackId={selectedTrackId}
                            favorites={favorites}
                            onToggleFavorite={onToggleFavorite}
                            onClick={() => { handlePresetClick(preset); }}
                            onContextMenu={(e) => { handleContextMenu(e, preset.id); }}
                            preview={preview}
                        />
                    ))}
                </div>
            )}

            {/* Factory Presets by Category */}
            {categoriesWithPresets.map((cat) => {
                const presetsInCat = filteredFactory.filter((p) => p.category === cat);
                const isCollapsed = collapsedCategories.has(cat);

                return (
                    <div key={cat}>
                        <button
                            className="flex w-full items-center gap-1 px-1 py-0.5"
                            onClick={() => { toggleCategoryCollapse(cat); }}
                        >
                            {isCollapsed
                                ? <ChevronRight className="size-3 text-muted-foreground" />
                                : <ChevronDown className="size-3 text-muted-foreground" />
                            }
                            <Folder className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase">{cat}</span>
                            <span className="ml-auto text-[9px] text-muted-foreground">{presetsInCat.length}</span>
                        </button>
                        {!isCollapsed && presetsInCat.map((preset) => (
                            <PresetItem
                                key={preset.id}
                                preset={preset}
                                selectedTrackId={selectedTrackId}
                                favorites={favorites}
                                onToggleFavorite={onToggleFavorite}
                                onClick={() => { handlePresetClick(preset); }}
                                preview={preview}
                            />
                        ))}
                    </div>
                );
            })}

            {filteredFactory.length === 0 && filteredUser.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No presets match your search.
                </p>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 min-w-[120px] rounded-md border border-border bg-popover p-1 shadow-md"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => { e.stopPropagation(); }}
                >
                    <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-accent/50"
                        onClick={() => { handleDeleteUserPreset(contextMenu.presetId); }}
                    >
                        <Trash2 className="size-3" aria-hidden="true" />
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Preset Item
// ---------------------------------------------------------------------------

const PresetItem = ({ preset, selectedTrackId, favorites, onToggleFavorite, onClick, onContextMenu, preview }: {
    preset: SoundPreset;
    selectedTrackId: string | null;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    onClick: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    preview: PreviewHandle;
}): ReactElement => {
    const chain = preset.devices.map((d) => d.name).join(" → ");

    return (
        <div
            className="group flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer"
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={selectedTrackId ? "Click to load onto selected track" : "Click to create a new track"}
        >
            <div className="flex items-center gap-1">
                <PreviewButton
                    isPlaying={preview.playingId === preset.id}
                    onPlay={() => { preview.playTone(preset.id, 261.63, 0.5); }}
                    onStop={preview.stop}
                />
                <span className="flex-1 text-xs font-medium text-foreground truncate">{preset.name}</span>
                <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[8px] font-medium capitalize", CATEGORY_COLORS[preset.category])}>
                    {preset.category}
                </span>
                <button
                    className={cn(
                        "size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                        favorites.has(preset.id) && "opacity-100",
                    )}
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(preset.id); }}
                    aria-label={favorites.has(preset.id) ? "Remove from favorites" : "Add to favorites"}
                >
                    <Star className={cn("size-3", favorites.has(preset.id) ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")} />
                </button>
            </div>
            <div className="flex items-center gap-1">
                {preset.trackKind === "midi"
                    ? <Piano className="size-2.5 text-purple-400 shrink-0" aria-label="MIDI track" />
                    : <Waves className="size-2.5 text-green-400 shrink-0" aria-label="Audio track" />
                }
                <span className="text-[9px] text-muted-foreground truncate">{chain}</span>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Favorites Tab
// ---------------------------------------------------------------------------

const FavoritesTab = ({ items, selectedTrackId }: { items: SampleItem[]; selectedTrackId: string | null }): ReactElement => {
    const favoritePresets = getFactoryPresets().filter((p) => {
        try {
            const stored = localStorage.getItem("webdaw-favorites");
            if (!stored) {
                return false;
            }
            const ids = JSON.parse(stored) as string[];
            return ids.includes(p.id);
        } catch {
            return false;
        }
    });

    const userFavoritePresets = getUserPresets().filter((p) => {
        try {
            const stored = localStorage.getItem("webdaw-favorites");
            if (!stored) {
                return false;
            }
            const ids = JSON.parse(stored) as string[];
            return ids.includes(p.id);
        } catch {
            return false;
        }
    });

    const allFavoritePresets = [...userFavoritePresets, ...favoritePresets];

    if (items.length === 0 && allFavoritePresets.length === 0) {
        return <p className="p-2 text-xs text-muted-foreground">No favorites yet. Star items to add them here.</p>;
    }

    const handleAddSample = (sample: SampleItem) => {
        let trackId = selectedTrackId;
        if (!trackId) {
            const newTrack = addTrack({ name: sample.name, kind: "audio" });
            if (!newTrack) {
                return;
            }
            trackId = newTrack.id;
        }
        const durationBeats = sample.durationSeconds ? Math.max(1, Math.ceil(sample.durationSeconds * 2)) : 8;
        addClip({ trackId, startBeat: 0, endBeat: durationBeats, name: sample.name, type: "audio", audioBufferId: sample.audioBufferId });
    };

    const handlePresetClick = (preset: SoundPreset) => {
        if (selectedTrackId) {
            loadPresetToTrack(selectedTrackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    };

    return (
        <div className="space-y-1">
            {allFavoritePresets.length > 0 && (
                <div>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <Headphones className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Presets</span>
                    </div>
                    {allFavoritePresets.map((preset) => (
                        <div
                            key={preset.id}
                            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50 cursor-pointer"
                            onClick={() => { handlePresetClick(preset); }}
                            title={selectedTrackId ? "Click to load onto selected track" : "Click to create a new track"}
                        >
                            <Star className="size-3 text-yellow-400 fill-yellow-400" />
                            {preset.trackKind === "midi"
                                ? <Piano className="size-2.5 text-purple-400" aria-label="MIDI" />
                                : <Waves className="size-2.5 text-green-400" aria-label="Audio" />
                            }
                            <span className="flex-1 text-xs text-foreground truncate">{preset.name}</span>
                            <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[8px] font-medium capitalize", CATEGORY_COLORS[preset.category])}>
                                {preset.category}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {items.length > 0 && (
                <div>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <FileAudio className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Samples</span>
                    </div>
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent/50 cursor-pointer"
                            onClick={() => { handleAddSample(item); }}
                            title="Click to add"
                        >
                            <Star className="size-3 text-yellow-400 fill-yellow-400" />
                            <span className="flex-1 text-xs text-foreground truncate">{item.name}</span>
                            <span className="text-[9px] text-muted-foreground">{item.duration}</span>
                            <Plus className="size-3 text-muted-foreground" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

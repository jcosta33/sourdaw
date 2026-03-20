import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Piano, Plus, Save, X, Headphones, ChevronRight, Star, Folder } from 'lucide-react';
import { type BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { addDevice } from '../../../useCases/workspaceViewActions';
import { addTrack } from '../../../useCases/workspaceViewActions';
import { type SoundPreset, type SoundPresetCategory } from '../../../useCases/workspaceViewActions';
import { getFactoryPresets } from '../../../useCases/workspaceViewActions';
import {
    createTrackFromPreset,
    loadPresetToTrack,
    getUserPresets,
    saveCurrentAsPreset,
    deleteUserPreset,
} from '../../../useCases/workspaceViewActions';
import { PresetItem } from '../../components/sidebar/PresetItem';
import { PRESET_CATEGORIES, CATEGORY_ICONS } from '../../components/sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';

export type InstrumentsTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
    selectedTrack: {
        id: string;
        name: string;
        kind: string;
        devices: { type: string; name: string; parameterValues: Record<string, number> }[];
    } | null;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
};

export const InstrumentsTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    selectedTrack,
    favorites,
    onToggleFavorite,
    preview,
    currentRoute,
    pushRoute,
}: InstrumentsTabProps): ReactElement => {
    const instruments = plugins.filter((p) => p.category === 'instrument');
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveFormName, setSaveFormName] = useState('');
    const [saveFormCategory, setSaveFormCategory] = useState<SoundPresetCategory>('synth');
    const [userPresetsVersion, setUserPresetsVersion] = useState(0);

    const handleAddInstrument = (plugin: (typeof BUILTIN_PLUGINS)[number]) => {
        const track = addTrack({ name: plugin.name, kind: 'midi' });
        if (!track) {
            return;
        }
        addDevice(track.id, plugin.name);
    };

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
            preset.tags.some((t) => t.toLowerCase().includes(query))
        );
    };

    const filteredFactory = factoryPresets.filter((p) => matchesSearch(p));
    const filteredUser = userPresets.filter((p) => matchesSearch(p));
    const categoriesWithPresets = PRESET_CATEGORIES.filter((cat) => filteredFactory.some((p) => p.category === cat));

    const handlePresetClick = (preset: SoundPreset) => {
        if (selectedTrackId) {
            loadPresetToTrack(selectedTrackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    };

    const handleSavePreset = () => {
        if (!selectedTrack || !saveFormName.trim()) {
            return;
        }
        saveCurrentAsPreset({
            name: saveFormName.trim(),
            category: saveFormCategory,
            trackKind: selectedTrack.kind === 'midi' ? 'midi' : 'audio',
            devices: selectedTrack.devices.map((d) => ({
                type: d.type,
                name: d.name,
                parameterValues: d.parameterValues,
            })),
        });
        setSaveFormName('');
        setShowSaveForm(false);
        setUserPresetsVersion((v) => v + 1);
    };

    const handleDeleteUserPreset = (presetId: string) => {
        deleteUserPreset(presetId);
        setUserPresetsVersion((v) => v + 1);
    };

    void userPresetsVersion;

    const isCategoryRoot = currentRoute.id === 'instruments';
    const currentCategorySlug = currentRoute.id.startsWith('instruments-') ? currentRoute.id.split('-')[1] : null;

    if (isCategoryRoot) {
        return (
            <div className="space-y-1 animate-in slide-in-from-left-4 duration-200">
                {/* Builtin Instruments */}
                {instruments.length > 0 && (
                    <>
                        <div className="flex items-center gap-1 px-1 py-0.5">
                            <Piano className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Instruments</span>
                        </div>
                        {instruments.map((plugin) => (
                            <div
                                key={plugin.id}
                                className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-surface-raised border border-transparent hover:border-border/40 transition-colors cursor-pointer group"
                                onClick={() => handleAddInstrument(plugin)}
                                title={`Click to create a new MIDI track with ${plugin.name}`}
                            >
                                <div>
                                    <span className="text-[11px] font-medium text-foreground/90">{plugin.name}</span>
                                    <span className="ml-1 text-[9px] text-muted-foreground group-hover:text-foreground/70 transition-colors">
                                        {plugin.parameters.length} p
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[9px] text-purple-400 font-medium">MIDI</span>
                                    <Plus className="size-3 text-foreground" />
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {/* Save Preset */}
                {selectedTrack && (
                    <div className="border-t border-border/30 pt-1.5 mt-2 mb-1">
                        {!showSaveForm ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="w-full justify-start gap-1.5 text-[10px] text-muted-foreground hover:text-foreground h-7"
                                onClick={() => setShowSaveForm(true)}
                            >
                                <Save className="size-3" aria-hidden="true" />
                                Save "{selectedTrack.name}" as Preset
                            </Button>
                        ) : (
                            <div className="space-y-1.5 px-1 py-1 rounded-md bg-surface-raised border border-border/40 animate-in fade-in duration-200">
                                <div className="flex items-center gap-1">
                                    <Input
                                        type="text"
                                        placeholder="Preset name…"
                                        value={saveFormName}
                                        onChange={(e) => setSaveFormName(e.target.value)}
                                        className="h-6 text-xs flex-1 bg-surface-base border-border/50"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSavePreset();
                                        }}
                                        autoFocus
                                    />
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="h-6 w-6"
                                        onClick={() => {
                                            setShowSaveForm(false);
                                            setSaveFormName('');
                                        }}
                                        aria-label="Cancel"
                                    >
                                        <X className="size-3" />
                                    </Button>
                                </div>
                                <div className="flex items-center gap-1">
                                    <select
                                        value={saveFormCategory}
                                        onChange={(e) => setSaveFormCategory(e.target.value as SoundPresetCategory)}
                                        className="h-6 flex-1 rounded border border-border/50 bg-surface-base text-[10px] text-foreground px-1"
                                    >
                                        {PRESET_CATEGORIES.map((cat) => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                    <Button
                                        variant="default"
                                        size="xs"
                                        className="text-[10px] h-6 px-2"
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

                {/* Categories Section */}
                <div className="flex items-center gap-1 px-1 py-0.5 pt-2 mb-1">
                    <Headphones className="size-3 text-muted-foreground" aria-hidden="true" />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Categories</span>
                </div>
                
                <div className="flex flex-col gap-[1px]">
                    <button
                        type="button"
                        className="flex w-full items-center justify-between px-2 py-2 rounded border border-transparent hover:bg-surface-raised hover:border-border/40 transition-colors group"
                        onClick={() => pushRoute({ id: 'instruments-user', title: 'My Presets' })}
                    >
                        <div className="flex items-center gap-2">
                            <Star className="size-3.5 text-yellow-400" aria-hidden="true" />
                            <span className="text-[11px] font-medium text-foreground/90 capitalize">My Presets</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors">{filteredUser.length}</span>
                            <ChevronRight className="size-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                        </div>
                    </button>

                    {categoriesWithPresets.map((cat) => {
                        const presetsInCat = filteredFactory.filter((p) => p.category === cat);
                        const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                        
                        return (
                            <button
                                key={cat}
                                type="button"
                                className="flex w-full items-center justify-between px-2 py-2 rounded border border-transparent hover:bg-surface-raised hover:border-border/40 transition-colors group"
                                onClick={() => pushRoute({ id: `instruments-${cat}`, title: cat })}
                            >
                                <div className="flex items-center gap-2">
                                    <CatIcon className="size-3.5 text-muted-foreground group-hover:text-foreground/80 transition-colors" aria-hidden="true" />
                                    <span className="text-[11px] font-medium text-foreground/90 capitalize">{cat}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors">{presetsInCat.length}</span>
                                    <ChevronRight className="size-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // Drill-down Category View
    let renderPresets: SoundPreset[] = [];
    if (currentCategorySlug === 'user') {
        renderPresets = filteredUser;
    } else if (currentCategorySlug) {
        renderPresets = filteredFactory.filter((p) => p.category === currentCategorySlug);
    }

    return (
        <div className="flex flex-col gap-1.5 p-1 animate-in slide-in-from-right-4 duration-200">
            {renderPresets.length > 0 ? (
                renderPresets.map((preset) => (
                    <PresetItem
                        key={preset.id}
                        preset={preset}
                        selectedTrackId={selectedTrackId}
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        onClick={() => handlePresetClick(preset)}
                        onContextMenu={(e) => {
                            if (currentCategorySlug === 'user') {
                                e.preventDefault();
                                handleDeleteUserPreset(preset.id);
                            }
                        }}
                        preview={preview}
                    />
                ))
            ) : (
                <div className="flex flex-col items-center justify-center py-10 opacity-60">
                    <span className="text-xs text-muted-foreground">No presets found.</span>
                </div>
            )}
        </div>
    );
};

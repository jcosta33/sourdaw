import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/helpers/Styles/cn';
import { Piano, Plus, Save, X, Headphones, ChevronDown, ChevronRight, Star, Folder } from 'lucide-react';
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
import { PresetItem } from './PresetItem';
import { PRESET_CATEGORIES, CATEGORY_ICONS } from './sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

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
};

export const InstrumentsTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    selectedTrack,
    favorites,
    onToggleFavorite,
    preview,
}: InstrumentsTabProps): ReactElement => {
    const instruments = plugins.filter((p) => p.category === 'instrument');
    const [activeCategory, setActiveCategory] = useState<SoundPresetCategory | null>(null);
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
        () => new Set([...PRESET_CATEGORIES, '__user__'])
    );
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

    const filteredFactory = factoryPresets.filter(
        (p) => (!activeCategory || p.category === activeCategory) && matchesSearch(p)
    );
    const filteredUser = userPresets.filter(
        (p) => (!activeCategory || p.category === activeCategory) && matchesSearch(p)
    );
    const categoriesWithPresets = PRESET_CATEGORIES.filter((cat) => filteredFactory.some((p) => p.category === cat));

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

    return (
        <div className="space-y-1">
            {/* Builtin Instruments */}
            {instruments.length > 0 && (
                <>
                    <div className="flex items-center gap-1 px-1 py-0.5">
                        <Piano className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-muted-foreground uppercase">Instruments</span>
                    </div>
                    {instruments.map((plugin) => (
                        <div
                            key={plugin.id}
                            className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-accent/50 cursor-pointer"
                            onClick={() => handleAddInstrument(plugin)}
                            title={`Click to create a new MIDI track with ${plugin.name}`}
                        >
                            <div>
                                <span className="text-xs font-medium text-foreground">{plugin.name}</span>
                                <span className="ml-1 text-[9px] text-muted-foreground">
                                    {plugin.parameters.length} params
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-[9px] text-purple-400">MIDI</span>
                                <Plus className="size-3 text-muted-foreground" />
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* Save Preset */}
            {selectedTrack && (
                <div className="border-t border-border/30 pt-1.5 mt-1">
                    {!showSaveForm ? (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="w-full justify-start gap-1 text-[10px]"
                            onClick={() => {
                                setShowSaveForm(true);
                            }}
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
                                    onChange={(e) => {
                                        setSaveFormName(e.target.value);
                                    }}
                                    className="h-6 text-xs flex-1"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleSavePreset();
                                        }
                                    }}
                                    autoFocus
                                />
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
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
                                    onChange={(e) => {
                                        setSaveFormCategory(e.target.value as SoundPresetCategory);
                                    }}
                                    className="h-6 flex-1 rounded border border-border/50 bg-transparent text-[10px] text-foreground px-1"
                                >
                                    {PRESET_CATEGORIES.map((cat) => (
                                        <option key={cat} value={cat}>
                                            {cat}
                                        </option>
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

            {/* Presets Section */}
            <div className="flex items-center gap-1 px-1 py-0.5 pt-2">
                <Headphones className="size-3 text-muted-foreground" aria-hidden="true" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase">Presets</span>
            </div>
            <div className="flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none">
                <button
                    type="button"
                    className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors',
                        activeCategory === null
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50'
                    )}
                    onClick={() => {
                        setActiveCategory(null);
                    }}
                >
                    All
                </button>
                {PRESET_CATEGORIES.map((cat) => (
                    <button
                        type="button"
                        key={cat}
                        className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium capitalize transition-colors',
                            activeCategory === cat
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-accent/50'
                        )}
                        onClick={() => {
                            setActiveCategory(activeCategory === cat ? null : cat);
                        }}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {filteredUser.length > 0 && (
                <div>
                    <button
                        type="button"
                        className="flex w-full items-center gap-1 px-1 py-0.5"
                        onClick={() => {
                            toggleCategoryCollapse('__user__');
                        }}
                    >
                        {collapsedCategories.has('__user__') ? (
                            <ChevronRight className="size-3 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="size-3 text-muted-foreground" />
                        )}
                        <Star className="size-3 text-yellow-400" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-yellow-400 uppercase">My Presets</span>
                        <span className="ml-auto text-[9px] text-muted-foreground">{filteredUser.length}</span>
                    </button>
                    {!collapsedCategories.has('__user__') &&
                        filteredUser.map((preset) => (
                            <PresetItem
                                key={preset.id}
                                preset={preset}
                                selectedTrackId={selectedTrackId}
                                favorites={favorites}
                                onToggleFavorite={onToggleFavorite}
                                onClick={() => {
                                    handlePresetClick(preset);
                                }}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    handleDeleteUserPreset(preset.id);
                                }}
                                preview={preview}
                            />
                        ))}
                </div>
            )}

            {categoriesWithPresets.map((cat) => {
                const presetsInCat = filteredFactory.filter((p) => p.category === cat);
                const isCollapsed = collapsedCategories.has(cat);
                return (
                    <div key={cat}>
                        <button
                            type="button"
                            className="flex w-full items-center gap-1 px-1 py-0.5"
                            onClick={() => {
                                toggleCategoryCollapse(cat);
                            }}
                        >
                            {isCollapsed ? (
                                <ChevronRight className="size-3 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="size-3 text-muted-foreground" />
                            )}
                            {(() => {
                                const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                                return <CatIcon className="size-3 text-muted-foreground" aria-hidden="true" />;
                            })()}
                            <span className="text-[10px] font-medium text-muted-foreground uppercase">{cat}</span>
                            <span className="ml-auto text-[9px] text-muted-foreground">{presetsInCat.length}</span>
                        </button>
                        {!isCollapsed &&
                            presetsInCat.map((preset) => (
                                <PresetItem
                                    key={preset.id}
                                    preset={preset}
                                    selectedTrackId={selectedTrackId}
                                    favorites={favorites}
                                    onToggleFavorite={onToggleFavorite}
                                    onClick={() => {
                                        handlePresetClick(preset);
                                    }}
                                    preview={preview}
                                />
                            ))}
                    </div>
                );
            })}

            {filteredFactory.length === 0 && filteredUser.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">No presets match your search.</p>
            )}
        </div>
    );
};

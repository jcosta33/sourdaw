import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Save, X, ChevronRight, Star, Folder } from 'lucide-react';
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
import { PRESET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../components/sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';

// ── Instrument Family Groups ────────────────────────────────────────────────
// Logical groupings of categories based on the synthesis approach / instrument family
// per .agents/instruments.md — Synthesis → Acoustic → Audio FX Chains

type InstrumentGroup = {
    label: string;
    description: string;
    categories: SoundPresetCategory[];
};

const INSTRUMENT_GROUPS: InstrumentGroup[] = [
    {
        label: 'Synth Instruments',
        description: 'Subtractive, FM & Faust synthesis — plays on MIDI tracks',
        categories: ['synth', 'bass', 'lead', 'pad', 'keys'],
    },
    {
        label: 'Acoustic & Percussion',
        description: 'Strings, guitar & drums — plays on MIDI or audio tracks',
        categories: ['strings', 'drums', 'guitar'],
    },
    {
        label: 'Textures & FX',
        description: 'Atmospheres, evolving pads & audio process chains',
        categories: ['fx', 'vocal'],
    },
];

// Per-category descriptions for richer context in the browser
const CATEGORY_SUBTITLES: Record<SoundPresetCategory, string> = {
    synth: 'Subtractive — osc + filter',
    bass: 'Sub, acid & analog bass',
    lead: 'Mono leads & arpeggios',
    pad: 'Evolving ambient pads',
    keys: 'Rhodes, organ & FM piano',
    drums: '808 kits & acoustic drums',
    fx: 'Sound design & mix chains',
    vocal: 'Vocal FX & audio chains',
    guitar: 'Guitar FX chains',
    strings: 'String ensemble patches',
};

// ── Types ───────────────────────────────────────────────────────────────────

type InstrumentsTabProps = {
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

// ── Component ───────────────────────────────────────────────────────────────

export const InstrumentsTab = ({
    selectedTrackId,
    searchQuery,
    selectedTrack,
    favorites,
    onToggleFavorite,
    preview,
    currentRoute,
    pushRoute,
}: InstrumentsTabProps): ReactElement => {
    const [showSaveForm, setShowSaveForm] = useState(false);
    const [saveFormName, setSaveFormName] = useState('');
    const [saveFormCategory, setSaveFormCategory] = useState<SoundPresetCategory>('synth');
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
            preset.tags.some((t) => t.toLowerCase().includes(query))
        );
    };

    const filteredFactory = factoryPresets.filter((p) => matchesSearch(p));
    const filteredUser = userPresets.filter((p) => matchesSearch(p));

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

    const handleAddBlankMidiTrack = () => {
        addTrack({ name: 'MIDI', kind: 'midi' });
    };

    void userPresetsVersion;

    // ── Route: root category picker ─────────────────────────────────────
    const isCategoryRoot = currentRoute.id === 'instruments';
    const currentCategorySlug = currentRoute.id.startsWith('instruments-')
        ? currentRoute.id.split('-').slice(1).join('-')
        : null;

    // If searching, flatten all results into one list
    if (isCategoryRoot && query) {
        const allResults = [...filteredFactory, ...filteredUser];
        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <div className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest px-1 py-0.5">
                    {allResults.length} result{allResults.length !== 1 ? 's' : ''} for "{query}"
                </div>
                {allResults.length > 0 ? (
                    allResults.map((preset) => (
                        <PresetItem
                            key={preset.id}
                            preset={preset}
                            selectedTrackId={selectedTrackId}
                            favorites={favorites}
                            onToggleFavorite={onToggleFavorite}
                            onClick={() => handlePresetClick(preset)}
                            preview={preview}
                        />
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No instruments found.</span>
                    </div>
                )}
            </div>
        );
    }

    // ── Route: category preset list ─────────────────────────────────────
    if (!isCategoryRoot && currentCategorySlug !== null) {
        let renderPresets: SoundPreset[] = [];
        if (currentCategorySlug === 'user') {
            renderPresets = filteredUser;
        } else {
            renderPresets = filteredFactory.filter((p) => p.category === currentCategorySlug);
        }

        const catSlug = currentCategorySlug as SoundPresetCategory;
        const CatIcon = CATEGORY_ICONS[catSlug] ?? Folder;
        const catColor = CATEGORY_COLORS[catSlug] ?? '';

        return (
            <div className="flex flex-col gap-1.5 animate-in slide-in-from-right-4 duration-200">
                {/* Category header */}
                <div className={`flex items-center gap-2 px-2 py-2 rounded-md mb-0.5 ${catColor}`}>
                    <CatIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider capitalize">
                        {currentCategorySlug === 'user' ? 'My Presets' : currentCategorySlug}
                    </span>
                    <span className="ml-auto text-[10px] opacity-70">{renderPresets.length}</span>
                </div>

                {/* Preset list */}
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
                        <span className="text-xs text-muted-foreground">No presets in this category.</span>
                    </div>
                )}
            </div>
        );
    }

    // ── Route: root instrument browser ──────────────────────────────────
    const categoriesWithPresets = PRESET_CATEGORIES.filter((cat) => filteredFactory.some((p) => p.category === cat));

    return (
        <div className="flex flex-col gap-0 animate-in slide-in-from-left-4 duration-200">
            {/* My Presets & Save – compact row at top */}
            <div className="flex items-center gap-1 mb-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 justify-between px-2 py-1.5 h-auto group border border-transparent hover:border-border/30"
                    onClick={() => pushRoute({ id: 'instruments-user', title: 'My Presets' })}
                >
                    <div className="flex items-center gap-1.5">
                        <Star className="size-3 text-[var(--color-accent-peach)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/80">My Presets</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[9px] text-muted-foreground">{filteredUser.length}</span>
                        <ChevronRight className="size-3 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </div>
                </Button>

                {selectedTrack && (
                    <>
                        {!showSaveForm ? (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="h-7 w-7 border border-transparent hover:border-border/30 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowSaveForm(true)}
                                title={`Save "${selectedTrack.name}" as preset`}
                            >
                                <Save className="size-3" aria-hidden="true" />
                            </Button>
                        ) : null}
                    </>
                )}
            </div>

            {/* Save form (inline) */}
            {showSaveForm && selectedTrack && (
                <div className="space-y-1.5 px-1 py-1 rounded-md bg-surface-raised border border-border/40 animate-in fade-in duration-200 mb-2">
                    <div className="flex items-center gap-1">
                        <Input
                            type="text"
                            placeholder="Preset name…"
                            value={saveFormName}
                            onChange={(e) => setSaveFormName(e.target.value)}
                            className="h-6 text-xs flex-1 bg-surface-base border-border/50"
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
                            className="h-6 flex-1 rounded border border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] text-[10px] text-foreground px-1"
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
                            className="text-[10px] h-6 px-2"
                            onClick={handleSavePreset}
                            disabled={!saveFormName.trim()}
                        >
                            Save
                        </Button>
                    </div>
                </div>
            )}

            {/* Instrument family groups */}
            {INSTRUMENT_GROUPS.map((group) => {
                const groupCats = group.categories.filter((cat) => categoriesWithPresets.includes(cat));
                if (groupCats.length === 0) {
                    return null;
                }

                return (
                    <div key={group.label} className="mb-3">
                        {/* Group header */}
                        <div className="flex items-center gap-1.5 px-1 py-0.5 mb-1">
                            <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                                {group.label}
                            </span>
                            <div className="flex-1 h-px bg-border/20" />
                        </div>

                        {/* Category buttons */}
                        <div className="flex flex-col gap-[2px]">
                            {groupCats.map((cat) => {
                                const presetsInCat = filteredFactory.filter((p) => p.category === cat);
                                const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                                const catColor = CATEGORY_COLORS[cat] ?? '';
                                const subtitle = CATEGORY_SUBTITLES[cat] ?? '';

                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-raised border border-transparent hover:border-border/30 transition-all group text-left"
                                        onClick={() => pushRoute({ id: `instruments-${cat}`, title: cat })}
                                    >
                                        {/* Icon badge */}
                                        <div
                                            className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md ${catColor}`}
                                        >
                                            <CatIcon className="size-3.5" aria-hidden="true" />
                                        </div>

                                        {/* Label + subtitle */}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-medium text-foreground/90 capitalize leading-tight">
                                                {cat}
                                            </div>
                                            <div className="text-[9px] text-muted-foreground/70 leading-tight truncate">
                                                {subtitle}
                                            </div>
                                        </div>

                                        {/* Count + chevron */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors tabular-nums">
                                                {presetsInCat.length}
                                            </span>
                                            <ChevronRight className="size-3.5 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {/* Blank track shortcut */}
            <div className="border-t border-border/20 pt-2 mt-1">
                <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised text-left transition-colors group"
                    onClick={handleAddBlankMidiTrack}
                    title="Add a blank MIDI track with a default synthesizer"
                >
                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors">
                        + Add blank MIDI track
                    </span>
                </button>
            </div>
        </div>
    );
};

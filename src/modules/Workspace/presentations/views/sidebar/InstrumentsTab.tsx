import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Save, X, ChevronRight, Star, Folder, Music2, Drum, Music } from 'lucide-react';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type SoundPreset, type SoundPresetCategory } from '#/modules/Arrangement/models/SoundPreset';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import { getUserPresets, saveCurrentAsPreset, deleteUserPreset } from '#/modules/Arrangement/useCases/preset/presetStorage';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { createDrumTrackStack } from '#/modules/Grinder/useCases/createDrumTrackStack';

import { PresetItem } from '../../components/sidebar/PresetItem';
import { PRESET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../components/sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';

// ── Instrument Family Groups ────────────────────────────────────────────────

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
];

// Device types that have their own internal preset explorers (excluded from Sounds)
const CUSTOM_UI_DEVICE_TYPES = new Set(['fermenter', 'grinder', 'orchestral']);

// Categories that belong in the Effects tab, not here
const EFFECTS_CATEGORIES = new Set<SoundPresetCategory>(['fx', 'vocal']);

// Per-category descriptions for richer context in the browser
const CATEGORY_SUBTITLES: Partial<Record<SoundPresetCategory, string>> = {
    synth: 'Subtractive — osc + filter',
    bass: 'Sub, acid & analog bass',
    lead: 'Mono leads & arpeggios',
    pad: 'Evolving ambient pads',
    keys: 'Rhodes, organ & FM piano',
    drums: '808 kits & acoustic drums',
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

    // Filter out presets that belong to custom-UI instruments or effects categories
    const isSoundPreset = (p: SoundPreset): boolean =>
        !p.devices.some((d) => CUSTOM_UI_DEVICE_TYPES.has(d.type)) &&
        !EFFECTS_CATEGORIES.has(p.category);

    const soundPresets = factoryPresets.filter((p) => isSoundPreset(p) && matchesSearch(p));
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

    const handleAddFermenterTrack = () => {
        const preset: SoundPreset = {
            id: 'fermenter-default', name: 'Fermenter', category: 'synth', description: 'Fermenter synthesizer',
            trackKind: 'midi', devices: [{ type: 'fermenter', name: 'Fermenter', parameterValues: {} }],
            tags: ['synth', 'wavetable', 'analog'], author: 'Sourdaw', isFactory: true,
        };
        createTrackFromPreset(preset);
    };

    const handleAddGrinderTrack = () => {
        createDrumTrackStack();
    };

    const handleAddOrchestralTrack = () => {
        const preset: SoundPreset = {
            id: 'orchestral-default', name: 'Orchestral', category: 'keys', description: 'Orchestral instrument',
            trackKind: 'midi', devices: [{ type: 'orchestral', name: 'Orchestral', parameterValues: {} }],
            tags: ['orchestral', 'strings', 'brass', 'woodwinds'], author: 'Sourdaw', isFactory: true,
        };
        createTrackFromPreset(preset);
    };

    void userPresetsVersion;

    // ── Route: root category picker ─────────────────────────────────────
    const isCategoryRoot = currentRoute.id === 'instruments';
    const currentCategorySlug = currentRoute.id.startsWith('instruments-')
        ? currentRoute.id.split('-').slice(1).join('-')
        : null;

    // If searching, flatten all results into one list
    if (isCategoryRoot && query) {
        const allResults = [...soundPresets, ...filteredUser];
        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <div className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest px-1 py-0.5">
                    {allResults.length} result{allResults.length !== 1 ? 's' : ''} for &quot;{query}&quot;
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
            renderPresets = soundPresets.filter((p) => p.category === currentCategorySlug);
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
    const categoriesWithPresets = PRESET_CATEGORIES.filter(
        (cat) => !EFFECTS_CATEGORIES.has(cat) && soundPresets.some((p) => p.category === cat)
    );

    return (
        <div className="flex flex-col gap-0 animate-in slide-in-from-left-4 duration-200">
            {/* ── Section: Instruments ─────────────────────────────────── */}
            <div className="flex items-center gap-1.5 px-1 py-0.5 mb-1.5">
                <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    Instruments
                </span>
                <div className="flex-1 h-px bg-border/20" />
            </div>

            {/* ── Fermenter ─────────────────────────────────────────── */}
            <div className="mb-1.5">
                <button
                    type="button"
                    className="w-full group relative overflow-hidden rounded-lg border border-[var(--color-accent-lavender)]/30 bg-gradient-to-br from-[var(--color-accent-lavender)]/10 via-surface-raised to-[var(--color-accent-lavender)]/5 hover:border-[var(--color-accent-lavender)]/50 hover:from-[var(--color-accent-lavender)]/15 transition-all duration-200 cursor-pointer"
                    onClick={handleAddFermenterTrack}
                >
                    <div className="flex items-center gap-3 px-3 py-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-accent-lavender)]/20 border border-[var(--color-accent-lavender)]/20 shadow-[0_0_12px_rgba(168,130,255,0.15)]">
                            <Music2 className="size-4.5 text-[var(--color-accent-lavender)]" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-bold text-foreground tracking-tight">Fermenter</span>
                                <span className="px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]">
                                    Synth
                                </span>
                            </div>
                            <div className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5">
                                Wavetable + VA oscillators · TPT filter · Mod matrix
                            </div>
                        </div>
                    </div>
                    <div className="absolute -top-6 -right-6 w-16 h-16 bg-[var(--color-accent-lavender)]/8 rounded-full blur-xl pointer-events-none" />
                </button>
            </div>

            {/* ── Grinder ───────────────────────────────────────────── */}
            <div className="mb-1.5">
                <button
                    type="button"
                    className="w-full group relative overflow-hidden rounded-lg border border-[var(--color-accent-peach)]/30 bg-gradient-to-br from-[var(--color-accent-peach)]/10 via-surface-raised to-[var(--color-accent-peach)]/5 hover:border-[var(--color-accent-peach)]/50 hover:from-[var(--color-accent-peach)]/15 transition-all duration-200 cursor-pointer"
                    onClick={handleAddGrinderTrack}
                >
                    <div className="flex items-center gap-3 px-3 py-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-accent-peach)]/20 border border-[var(--color-accent-peach)]/20 shadow-[0_0_12px_rgba(232,160,96,0.15)]">
                            <Drum className="size-4.5 text-[var(--color-accent-peach)]" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-bold text-foreground tracking-tight">Grinder</span>
                                <span className="px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]">
                                    Drums
                                </span>
                            </div>
                            <div className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5">
                                808/909 synth engines · Step sequencer · 16 pads
                            </div>
                        </div>
                    </div>
                    <div className="absolute -top-6 -right-6 w-16 h-16 bg-[var(--color-accent-peach)]/8 rounded-full blur-xl pointer-events-none" />
                </button>
            </div>

            {/* ── Orchestral ─────────────────────────────────────────── */}
            <div className="mb-3">
                <button
                    type="button"
                    className="w-full group relative overflow-hidden rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-surface-raised to-amber-500/5 hover:border-amber-500/50 hover:from-amber-500/15 transition-all duration-200 cursor-pointer"
                    onClick={handleAddOrchestralTrack}
                >
                    <div className="flex items-center gap-3 px-3 py-3">
                        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                            <Music className="size-4.5 text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-bold text-foreground tracking-tight">Orchestral</span>
                                <span className="px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400">
                                    Orchestra
                                </span>
                            </div>
                            <div className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5">
                                Sample playback · Legato · Expression · Multi-mic
                            </div>
                        </div>
                    </div>
                    <div className="absolute -top-6 -right-6 w-16 h-16 bg-amber-500/8 rounded-full blur-xl pointer-events-none" />
                </button>
            </div>

            {/* ── Section: Sounds ──────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 px-1 py-0.5 mb-1.5">
                <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    Sounds
                </span>
                <div className="flex-1 h-px bg-border/20" />
            </div>

            {/* My Presets & Save */}
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

                {selectedTrack ? (
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
                ) : null}
            </div>

            {/* Save form (inline) */}
            {showSaveForm && selectedTrack ? (
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
            ) : null}

            {/* Sound preset category groups */}
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
                                const presetsInCat = soundPresets.filter((p) => p.category === cat);
                                const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                                const catColor = CATEGORY_COLORS[cat] ?? '';
                                const subtitle = CATEGORY_SUBTITLES[cat] ?? '';

                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-raised border border-transparent hover:border-border/30 transition-all group text-left cursor-pointer"
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
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised text-left transition-colors group cursor-pointer"
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

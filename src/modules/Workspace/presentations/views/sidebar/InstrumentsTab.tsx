import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Save, X, ChevronRight, Star, Folder, Music2, Drum, Music } from 'lucide-react';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type SoundPreset, type SoundPresetCategory } from '#/modules/Arrangement/useCases/trackQueries';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import { getUserPresets, saveCurrentAsPreset, deleteUserPreset } from '#/modules/Arrangement/useCases/preset/presetStorage';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { createDrumTrackStack } from '#/modules/Toaster/useCases/createDrumTrackStack';

import { PresetItem } from '../../components/sidebar/PresetItem';
import { InstrumentCard, FERMENTER_THEME, TOASTER_THEME, LEVAIN_THEME } from '../../components/sidebar/InstrumentCard';
import { SectionHeader } from '../../components/sidebar/SectionHeader';
import { EmptyState } from '../../components/sidebar/EmptyState';
import { NavCard } from '../Sidebar/effectsTabHelpers';
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
const CUSTOM_UI_DEVICE_TYPES = new Set(['fermenter', 'grinder', 'levain']);

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

    const handleAddLevainTrack = () => {
        const preset: SoundPreset = {
            id: 'levain-default', name: 'Levain', category: 'keys', description: 'Levain instrument',
            trackKind: 'midi', devices: [{ type: 'levain', name: 'Levain', parameterValues: {} }],
            tags: ['levain', 'strings', 'brass', 'woodwinds'], author: 'Sourdaw', isFactory: true,
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
                    <EmptyState message="No instruments found." />
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
                    <EmptyState message="No presets in this category." />
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
            <SectionHeader label="Instruments" />

            <div className="flex flex-col gap-1.5 mb-3">
                <InstrumentCard
                    icon={Music2}
                    label="Fermenter"
                    badge="Synth"
                    description="Wavetable + VA oscillators · TPT filter · Mod matrix"
                    onClick={handleAddFermenterTrack}
                    theme={FERMENTER_THEME}
                />
                <InstrumentCard
                    icon={Drum}
                    label="Toaster"
                    badge="Drums"
                    description="808/909 synth engines · Step sequencer · 16 pads"
                    onClick={handleAddGrinderTrack}
                    theme={TOASTER_THEME}
                />
                <InstrumentCard
                    icon={Music}
                    label="Levain"
                    badge="Orchestra"
                    description="Sample playback · Legato · Expression · Multi-mic"
                    onClick={handleAddLevainTrack}
                    theme={LEVAIN_THEME}
                />
            </div>

            {/* ── Section: Sounds ──────────────────────────────────────── */}
            <SectionHeader label="Sounds" />

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
                        <SectionHeader label={group.label} />
                        <div className="flex flex-col gap-0">
                            {groupCats.map((cat) => {
                                const presetsInCat = soundPresets.filter((p) => p.category === cat);
                                const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                                const catColor = CATEGORY_COLORS[cat] ?? '';
                                const subtitle = CATEGORY_SUBTITLES[cat] ?? '';

                                return (
                                    <NavCard
                                        key={cat}
                                        icon={CatIcon}
                                        label={cat}
                                        description={subtitle}
                                        count={presetsInCat.length}
                                        color={catColor}
                                        onClick={() => pushRoute({ id: `instruments-${cat}`, title: cat })}
                                    />
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

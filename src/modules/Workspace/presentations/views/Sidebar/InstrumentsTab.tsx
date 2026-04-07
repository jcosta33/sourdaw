import { type ReactElement, useState } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Save, X, ChevronRight, Star, Folder, Music2, Drum, Music, Piano, Disc3 } from 'lucide-react';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { type SoundPresetView as SoundPreset, type SoundPresetCategory } from '../../../models/SoundPresetViewTypes';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import {
    getUserPresets,
    saveCurrentAsPreset,
    deleteUserPreset,
} from '#/modules/Arrangement/useCases/preset/presetStorage';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { createDrumTrackStack } from '#/modules/Toaster/useCases/createDrumTrackStack';
import { createGrandBouleTrack } from '#/modules/GrandBoule/useCases/createGrandBouleTrack';
import { eventBus } from '#/app/registerDependencies';

import { PresetItem } from '../../components/Sidebar/PresetItem';
import {
    InstrumentCard,
    FERMENTER_THEME,
    TOASTER_THEME,
    LEVAIN_THEME,
    SAMPLER_THEME,
    GRAND_BOULE_THEME,
} from '../../components/Sidebar/InstrumentCard';
import { EmptyState } from '../../components/Sidebar/EmptyState';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { NavCard } from '../Sidebar/effectsTabHelpers';
import { PRESET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../components/Sidebar/sidebarConstants';
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
        description: 'Subtractive, FM & morphing synthesis',
        categories: ['synth', 'bass', 'lead', 'pad', 'keys'],
    },
    {
        label: 'Acoustic & Percussion',
        description: 'Strings, guitar & drums — plays on MIDI or audio tracks',
        categories: ['strings', 'drums', 'guitar'],
    },
];

// Device types that have their own internal preset explorers (excluded from Sounds)
const CUSTOM_UI_DEVICE_TYPES = new Set(['fermenter', 'toaster', 'levain', 'builtin-sampler', 'grand-boule']);

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
        !p.devices.some((d) => CUSTOM_UI_DEVICE_TYPES.has(d.type)) && !EFFECTS_CATEGORIES.has(p.category);

    const soundPresets = factoryPresets.filter((p) => isSoundPreset(p) && matchesSearch(p));
    const filteredUser = userPresets.filter((p) => matchesSearch(p));

    const handlePresetClick = (preset: SoundPreset) => {
        // Load onto the selected track if it's a compatible kind, else create new
        const trackKindMatches =
            selectedTrack?.kind === preset.trackKind ||
            (preset.trackKind === 'midi' && selectedTrack?.kind === 'midi') ||
            (preset.trackKind === 'audio' && selectedTrack?.kind === 'audio');
        if (selectedTrackId && trackKindMatches) {
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
            id: 'fermenter-default',
            name: 'Fermenter',
            category: 'synth',
            description: 'Fermenter synthesizer',
            trackKind: 'midi',
            devices: [{ type: 'fermenter', name: 'Fermenter', parameterValues: {} }],
            tags: ['synth', 'wavetable', 'analog'],
            author: 'Sourdaw',
            isFactory: true,
        };
        const trackId = createTrackFromPreset(preset);
        const track = trackId ? getAllTracks().find((t) => t.id === trackId) : null;
        const device = track?.devices.find((d) => d.type === 'fermenter');
        void eventBus.emit('panel.showFermenter', { deviceId: device?.id ?? null });
    };

    const handleAddToasterTrack = () => {
        const trackId = createDrumTrackStack();
        const track = trackId ? getAllTracks().find((t) => t.id === trackId) : null;
        const device = track?.devices.find((d) => d.type === 'toaster');
        void eventBus.emit('panel.showToaster', { deviceId: device?.id ?? null });
    };

    const handleAddGrandBouleTrack = () => {
        const trackId = createGrandBouleTrack();
        const track = trackId ? getAllTracks().find((t) => t.id === trackId) : null;
        const device = track?.devices.find((d) => d.type === 'grand-boule');
        void eventBus.emit('panel.showGrandBoule', { deviceId: device?.id ?? null });
    };

    const handleAddLevainTrack = () => {
        const preset: SoundPreset = {
            id: 'levain-default',
            name: 'Levain',
            category: 'keys',
            description: 'Levain instrument',
            trackKind: 'midi',
            devices: [{ type: 'levain', name: 'Levain', parameterValues: {} }],
            tags: ['levain', 'strings', 'brass', 'woodwinds'],
            author: 'Sourdaw',
            isFactory: true,
        };
        createTrackFromPreset(preset);
        void eventBus.emit('panel.showLevain', { deviceId: null });
    };

    const handleAddSamplerTrack = () => {
        const preset: SoundPreset = {
            id: 'sampler-default',
            name: 'Sampler',
            category: 'keys',
            description: 'Unified Sampler Suite',
            trackKind: 'midi',
            devices: [{ type: 'builtin-sampler', name: 'Sampler', parameterValues: {} }],
            tags: ['sampler', 'sample', 'playback'],
            author: 'Sourdaw',
            isFactory: true,
        };
        const trackId = createTrackFromPreset(preset);
        const track = trackId ? getAllTracks().find((t) => t.id === trackId) : null;
        const device = track?.devices.find((d) => d.type === 'builtin-sampler');
        void eventBus.emit('panel.showCrumbs', { deviceId: device?.id ?? null });
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
                <SearchSummary count={allResults.length} query={query} className="px-1 py-0.5" />
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

        return (
            <div className="flex flex-col gap-1.5 animate-in slide-in-from-right-4 duration-200">
                {/* Preset list (header handled by Sidebar back bar with icon) */}
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
                            hideCategory
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
        <div className="flex flex-col gap-0 px-1.5 pb-4 animate-in slide-in-from-left-4 duration-200">
            {/* ── House Specials ─────────────────────────────────── */}
            <div className="flex flex-col gap-1.5 mb-3">
                <DawSectionDivider
                    label="Play Dough"
                    className="mb-0.5 px-1"
                    labelClassName="font-bold text-[var(--color-accent-orange)]"
                    lineClassName="bg-[var(--color-accent-orange)]/15"
                />
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
                    onClick={handleAddToasterTrack}
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
                <InstrumentCard
                    icon={Disc3}
                    label="Sampler"
                    badge="Sample"
                    description="Quick · Drum · Slice · Warp — drag & drop any audio"
                    onClick={handleAddSamplerTrack}
                    theme={SAMPLER_THEME}
                />
                <InstrumentCard
                    icon={Piano}
                    label="Grand Boule"
                    badge="Piano"
                    description="Physical modeling · 88 keys · Modal synthesis · Pedals"
                    onClick={handleAddGrandBouleTrack}
                    theme={GRAND_BOULE_THEME}
                />
            </div>

            {/* ── Preset Pantry ── */}
            <DawSectionDivider
                label="Simple Loaves"
                className="mb-1 mt-1 px-1"
                labelClassName="text-muted-foreground/50"
                lineClassName="bg-border/15"
            />

            {/* My Presets & Save */}
            <div className="flex items-center gap-1 mb-2">
                <DawPickerRow
                    compact
                    className="flex-1 px-2 py-1.5"
                    startSlot={<Star className="size-3 text-[var(--color-accent-peach)]" aria-hidden="true" />}
                    heading="My Presets"
                    description={`${filteredUser.length} saved`}
                    endSlot={
                        <div className="flex items-center gap-1">
                            <span className="text-[9px] text-muted-foreground">{filteredUser.length}</span>
                            <ChevronRight className="size-3 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                        </div>
                    }
                    onClick={() => pushRoute({ id: 'instruments-user', title: 'My Presets' })}
                />

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
                        <DawCompactSelect
                            value={saveFormCategory}
                            onChange={(e) => setSaveFormCategory(e.target.value as SoundPresetCategory)}
                            tone="inset"
                            className="flex-1 px-1 text-[10px]"
                        >
                            {PRESET_CATEGORIES.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat}
                                </option>
                            ))}
                        </DawCompactSelect>
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
                    <div key={group.label} className="mb-2">
                        <div className="flex flex-col gap-0">
                            {groupCats.map((cat) => {
                                const presetsInCat = soundPresets.filter((p) => p.category === cat);
                                const CatIcon = CATEGORY_ICONS[cat] ?? Folder;
                                const catColor = CATEGORY_COLORS[cat] ?? '';
                                const subtitle = CATEGORY_SUBTITLES[cat] ?? '';

                                const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
                                return (
                                    <NavCard
                                        key={cat}
                                        icon={CatIcon}
                                        label={catLabel}
                                        description={subtitle}
                                        count={presetsInCat.length}
                                        color={catColor}
                                        onClick={() =>
                                            pushRoute({
                                                id: `instruments-${cat}`,
                                                title: catLabel,
                                                icon: CatIcon,
                                                iconColor: catColor.split(' ').find((c) => c.startsWith('text-')),
                                            })
                                        }
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {/* Blank track shortcut */}
            <div className="border-t border-border/20 pt-2 mt-1">
                <DawPickerRow
                    compact
                    className="px-2 py-1.5"
                    heading="+ Add blank MIDI track"
                    description="Create a plain track with the default synth"
                    onClick={handleAddBlankMidiTrack}
                    title="Add a blank MIDI track with a default synthesizer"
                />
            </div>
        </div>
    );
};

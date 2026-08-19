import { type ReactElement, useState } from 'react';

import { Save, X, ChevronRight, Star, Folder, Music2, Drum, Music, Piano, Disc3 } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import {
    addTrack,
    getFactoryPresets,
    getUserPresets,
    saveCurrentAsPreset,
    deleteUserPreset,
    compileLoadPresetActions,
} from '#/modules/Arrangement/useCases';
import { compileToasterTrackStackActions } from '#/modules/Toaster/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type SoundPresetView as SoundPreset, type SoundPresetCategory } from '../../../models/SoundPresetViewTypes';
import { executePresetLoad } from '../../../useCases/executePresetLoad';
import { EmptyState } from '../../components/Sidebar/EmptyState';
import {
    InstrumentCard,
    FERMENTER_THEME,
    TOASTER_THEME,
    LEVAIN_THEME,
    CRUMBS_THEME,
    GRAND_BOULE_THEME,
} from '../../components/Sidebar/InstrumentCard';
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { PRESET_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../components/Sidebar/sidebarConstants';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { NavCard } from '../Sidebar/effectsTabHelpers';

import { type SidebarRoute, type SidebarPanelActions } from './SidebarTypes';

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
    panelActions?: SidebarPanelActions;
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
    panelActions,
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
            preset.tags.some((time) => time.toLowerCase().includes(query))
        );
    };

    // Filter out presets that belong to custom-UI instruments or effects categories
    const isSoundPreset = (param: SoundPreset): boolean =>
        !param.devices.some((data) => CUSTOM_UI_DEVICE_TYPES.has(data.type)) && !EFFECTS_CATEGORIES.has(param.category);

    const soundPresets = factoryPresets.filter((param) => isSoundPreset(param) && matchesSearch(param));
    const filteredUser = userPresets.filter((param) => matchesSearch(param));

    const executeCatalogPreset = async (presetId: string, trackId?: string) => {
        const plan = compileLoadPresetActions({ presetId, ...(trackId ? { trackId } : {}) });
        if (!plan) {
            notifyUser('Preset cannot be applied to the current track.', 'error');
            return null;
        }
        try {
            await executePresetLoad(plan);
            return plan;
        } catch {
            notifyUser('Preset project changes require runtime retry or repair.', 'error');
            return null;
        }
    };

    const handlePresetClick = (preset: SoundPreset) => {
        // Load onto the selected track if it's a compatible kind, else create new
        const trackKindMatches =
            selectedTrack?.kind === preset.trackKind ||
            (preset.trackKind === 'midi' && selectedTrack?.kind === 'midi') ||
            (preset.trackKind === 'audio' && selectedTrack?.kind === 'audio');
        if (selectedTrackId && trackKindMatches) {
            void executeCatalogPreset(preset.id, selectedTrackId);
        } else {
            void executeCatalogPreset(preset.id);
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
            devices: selectedTrack.devices.map((data) => ({
                type: data.type,
                name: data.name,
                parameterValues: data.parameterValues,
            })),
        });
        setSaveFormName('');
        setShowSaveForm(false);
        setUserPresetsVersion((value) => value + 1);
    };

    const handleDeleteUserPreset = (presetId: string) => {
        deleteUserPreset(presetId);
        setUserPresetsVersion((value) => value + 1);
    };

    const handleAddBlankMidiTrack = () => {
        addTrack({ name: 'MIDI', kind: 'midi' });
    };

    const handleAddFermenterTrack = () => {
        void executeCatalogPreset('fermenter-default').then((plan) => {
            panelActions?.showFermenter(plan?.deviceIds[0] ?? null);
        });
    };

    const handleAddToasterTrack = () => {
        const plan = compileToasterTrackStackActions();
        if (!plan) {
            notifyUser('Toaster Kit cannot be created in the current project.', 'error');
            return;
        }
        void executePresetLoad(plan)
            .then(() => panelActions?.showToaster(plan.deviceIds[0] ?? null))
            .catch(() => notifyUser('Toaster Kit project changes require runtime retry or repair.', 'error'));
    };

    const handleAddGrandBouleTrack = () => {
        void executeCatalogPreset('grand-boule-default').then((plan) => {
            panelActions?.showGrandBoule(plan?.deviceIds[0] ?? null);
        });
    };

    const handleAddLevainTrack = () => {
        void executeCatalogPreset('levain-default').then((plan) => {
            panelActions?.showLevain(plan?.deviceIds[0] ?? null);
        });
    };

    const handleAddCrumbsTrack = () => {
        void executeCatalogPreset('sampler-default').then((plan) => {
            panelActions?.showCrumbs(plan?.deviceIds[0] ?? null);
        });
    };

    void userPresetsVersion; // Read to cause re-render when preset version bumps

    // ── Route: root category picker ─────────────────────────────────────
    const isCategoryRoot = currentRoute.id === 'instruments';
    const currentCategorySlug = currentRoute.id.startsWith('instruments-')
        ? currentRoute.id.split('-').slice(1).join('-')
        : null;

    // If searching, flatten all results into one list
    if (isCategoryRoot && query) {
        const allResults = [...soundPresets, ...filteredUser];

        const renderPremiumInstrument = (id: string) => {
            switch (id) {
                case 'fermenter':
                    return (
                        <InstrumentCard
                            icon={Music2}
                            label="Fermenter"
                            badge="Synth"
                            description="Wavetable + VA oscillators · TPT filter · Mod matrix"
                            onClick={handleAddFermenterTrack}
                            theme={FERMENTER_THEME}
                        />
                    );
                case 'toaster':
                    return (
                        <InstrumentCard
                            icon={Drum}
                            label="Toaster"
                            badge="Drums"
                            description="808/909 synth engines · Step sequencer · 16 pads"
                            onClick={handleAddToasterTrack}
                            theme={TOASTER_THEME}
                        />
                    );
                case 'levain':
                    return (
                        <InstrumentCard
                            icon={Music}
                            label="Levain"
                            badge="Orchestra"
                            description="Sample playback · Legato · Expression · Multi-mic"
                            onClick={handleAddLevainTrack}
                            theme={LEVAIN_THEME}
                        />
                    );
                case 'crumbs':
                    return (
                        <InstrumentCard
                            icon={Disc3}
                            label="Crumbs"
                            badge="Sample"
                            description="Quick · Drum · Slice · Warp — drag & drop any audio"
                            onClick={handleAddCrumbsTrack}
                            theme={CRUMBS_THEME}
                        />
                    );
                case 'grand-boule':
                    return (
                        <InstrumentCard
                            icon={Piano}
                            label="Grand Boule"
                            badge="Piano"
                            description="Physical modeling · 88 keys · Modal synthesis · Pedals"
                            onClick={handleAddGrandBouleTrack}
                            theme={GRAND_BOULE_THEME}
                        />
                    );
                default:
                    return null;
            }
        };

        const premiumMatches = ['fermenter', 'toaster', 'levain', 'crumbs', 'grand-boule'].filter((id) => {
            const name = id.replace('-', ' ');
            return name.toLowerCase().includes(query) || (id === 'crumbs' && 'crumbs'.includes(query));
        });

        const totalCount = allResults.length + premiumMatches.length;

        return (
            <div className="flex flex-col gap-1.5 animate-in fade-in duration-100">
                <SearchSummary count={totalCount} query={query} className="px-1 py-0.5" />
                {totalCount > 0 ? (
                    <>
                        {premiumMatches.map((id) => {
                            const card = renderPremiumInstrument(id);
                            if (card) {
                                return (
                                    <div key={id} className="mb-3 mt-1.5 px-0.5 drop-shadow-sm">
                                        {card}
                                    </div>
                                );
                            }
                            return null;
                        })}
                        {allResults.map((preset) => (
                            <PresetItem
                                key={preset.id}
                                preset={preset}
                                selectedTrackId={selectedTrackId}
                                favorites={favorites}
                                onToggleFavorite={onToggleFavorite}
                                onClick={() => handlePresetClick(preset)}
                                preview={preview}
                            />
                        ))}
                    </>
                ) : (
                    <EmptyState message="No instruments found." />
                )}
            </div>
        );
    }

    // ── Route: category preset list ─────────────────────────────────────
    if (!isCategoryRoot && currentCategorySlug !== null) {
        let renderPresets: SoundPreset[];
        if (currentCategorySlug === 'user') {
            renderPresets = filteredUser;
        } else {
            renderPresets = soundPresets.filter((param) => param.category === currentCategorySlug);
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
                            onContextMenu={(event) => {
                                if (currentCategorySlug === 'user') {
                                    event.preventDefault();
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
        (cat) => !EFFECTS_CATEGORIES.has(cat) && soundPresets.some((param) => param.category === cat)
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
                    label="Crumbs"
                    badge="Sample"
                    description="Quick · Drum · Slice · Warp — drag & drop any audio"
                    onClick={handleAddCrumbsTrack}
                    theme={CRUMBS_THEME}
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
            <DawSectionDivider
                label="Standard grain"
                className="mb-1 px-1"
                labelClassName="font-bold text-[var(--color-accent-cyan)]"
                lineClassName="bg-[var(--color-accent-cyan)]/15"
            />
            {/* Sound preset category groups */}
            {INSTRUMENT_GROUPS.map((group) => {
                const groupCats = group.categories.filter((cat) => categoriesWithPresets.includes(cat));
                if (groupCats.length === 0) {
                    return null;
                }

                return (
                    <div key={group.label} className="mb-2">
                        <div className="flex flex-col gap-1.5">
                            {groupCats.map((cat) => {
                                const presetsInCat = soundPresets.filter((param) => param.category === cat);
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
                                                iconColor: catColor
                                                    .split(' ')
                                                    .find((context) => context.startsWith('text-')),
                                            })
                                        }
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            {/* My Presets & Save */}
            <DawSectionDivider
                label="User Library"
                className="mb-3 mt-4 px-1"
                labelClassName="font-bold text-[var(--color-accent-orange)]"
                lineClassName="bg-[var(--color-accent-orange)]/15"
            />
            <div className="flex items-center gap-1 mb-2">
                <DawPickerRow
                    compact
                    className="flex-1 px-2 py-1.5 bg-gradient-to-br from-surface-raised to-surface-base border border-border/20 transition-colors hover:from-surface-overlay hover:border-border/40 shadow-sm"
                    startSlot={<Star className="size-4 text-[var(--color-accent-peach)]" aria-hidden="true" />}
                    heading="My Presets"
                    description={`${filteredUser.length} saved`}
                    endSlot={
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                                {filteredUser.length}
                            </span>
                            <ChevronRight className="size-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
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
                                className="h-9 w-9 border border-border/20 bg-surface-raised hover:border-border/40 text-muted-foreground hover:text-foreground shadow-sm"
                                onClick={() => setShowSaveForm(true)}
                                title={`Save "${selectedTrack.name}" as preset`}
                            >
                                <Save className="size-4" aria-hidden="true" />
                            </Button>
                        ) : null}
                    </>
                ) : null}
            </div>
            {/* Save form (inline) */}
            {showSaveForm && selectedTrack ? (
                <div className="space-y-1.5 px-2 py-2 rounded-md bg-gradient-to-br from-surface-raised to-surface-base border border-border/40 shadow-sm animate-in fade-in duration-100 mb-2">
                    <div className="flex items-center gap-1">
                        <Input
                            type="text"
                            placeholder="Preset name…"
                            value={saveFormName}
                            onChange={(event) => setSaveFormName(event.target.value)}
                            className="h-7 text-xs flex-1 bg-surface-default border-border/50 focus-visible:border-border/80"
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleSavePreset();
                                }
                            }}
                            autoFocus
                        />
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 hover:bg-surface-overlay"
                            onClick={() => {
                                setShowSaveForm(false);
                                setSaveFormName('');
                            }}
                            aria-label="Cancel"
                        >
                            <X className="size-3.5" />
                        </Button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                        <DawCompactSelect
                            value={saveFormCategory}
                            onChange={(event) => setSaveFormCategory(event.target.value as SoundPresetCategory)}
                            tone="inset"
                            className="flex-1 px-1 text-[11px] h-7 bg-surface-default"
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
                            className="text-[11px] h-7 px-3 bg-[var(--color-accent-orange)] text-orange-950 hover:bg-[var(--color-accent-orange)]/90"
                            onClick={handleSavePreset}
                            disabled={!saveFormName.trim()}
                        >
                            Save
                        </Button>
                    </div>
                </div>
            ) : null}
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

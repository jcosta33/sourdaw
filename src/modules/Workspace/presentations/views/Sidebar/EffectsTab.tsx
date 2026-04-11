import { type ReactElement } from 'react';
import {
    Shield,
    Waves as WavesIcon,
    Gauge,
    Sparkles,
    AudioLines,
    Layers,
    Guitar,
    Bug,
    GitBranch,
    Sliders,
} from 'lucide-react';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import {
    InstrumentCard,
    PROOF_THEME,
    SCORING_THEME,
    DUTCH_OVEN_THEME,
    GLUTEN_THEME,
    CRUST_THEME,
    GRINDER_THEME,
    BACTERIA_THEME,
    YEAST_THEME,
} from '../../components/Sidebar/InstrumentCard';
import {
    showProofPanel,
    showGlutenPanel,
    showCrustPanel,
    showDutchOvenPanel,
    showScoringPanel,
    showGrinderPanel,
    showBacteriaPanel,
    showYeastPanel,
} from '../../../useCases/panels/devicePanels';
import {
    addDevice,
    getFactoryPresets,
    createTrackFromPreset,
    loadPresetToTrack,
} from '#/modules/Arrangement/useCases';
import { type PluginDescriptorView as PluginDescriptor } from '../../../models/PluginDescriptorViewTypes';
import { type SoundPresetView as SoundPreset } from '../../../models/SoundPresetViewTypes';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views';
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { EmptyState } from '../../components/Sidebar/EmptyState';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from './SidebarTypes';
import { NavCard, EffectItem, EFFECT_GROUPS, type EffectPlugin, Waves, Music2, SoonBadge } from './effectsTabHelpers';
import { MODULATOR_PRESETS, MIDI_EFFECT_FACTORIES } from '#/modules/Plugin';

const FX_PRESET_CATEGORIES = new Set(['fx', 'vocal']);

type EffectsTabProps = {
    plugins: readonly PluginDescriptor[];
    selectedTrackId: string | null;
    searchQuery: string;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
};

export const EffectsTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    currentRoute,
    pushRoute,
    favorites,
    onToggleFavorite,
    preview,
}: EffectsTabProps): ReactElement => {
    const isEffectPlugin = (p: EffectPlugin) => p.category !== 'instrument';

    const effects = plugins.filter(isEffectPlugin);
    const query = searchQuery.toLowerCase().trim();

    const fxPresets = getFactoryPresets().filter((p) => FX_PRESET_CATEGORIES.has(p.category));
    const filteredFxPresets = query
        ? fxPresets.filter(
              (p) => p.name.toLowerCase().includes(query) || p.tags.some((t) => t.toLowerCase().includes(query))
          )
        : fxPresets;

    const handleFxPresetClick = (preset: SoundPreset) => {
        if (selectedTrackId) loadPresetToTrack(selectedTrackId, preset);
        else createTrackFromPreset(preset);
    };

    const groupedEffects = new Map<string, EffectPlugin[]>();
    const uncategorized: EffectPlugin[] = [];

    for (const plugin of effects) {
        const idKey = plugin.id
            .replace(/^builtin-/, '')
            .replace(/^native-/, '')
            .toLowerCase();
        const group = EFFECT_GROUPS.find((g) => g.categories.some((gc) => idKey === gc || idKey.includes(gc)));
        if (group) {
            const existing = groupedEffects.get(group.id) ?? [];
            existing.push(plugin);
            groupedEffects.set(group.id, existing);
        } else {
            uncategorized.push(plugin);
        }
    }

    const visibleEffectGroups = EFFECT_GROUPS.filter((g) => (groupedEffects.get(g.id)?.length ?? 0) > 0);
    const totalAudioFx = effects.length;

    const renderPremiumCard = (id: string) => {
        switch (id) {
            case 'proof':
                return (
                    <InstrumentCard
                        icon={Shield}
                        label="Proof"
                        badge="Mastering"
                        description="EQ · Multiband Dynamics · Imager"
                        onClick={() => {
                            if (selectedTrackId) {
                                const device = addDevice(selectedTrackId, 'Proof');
                                showProofPanel(device?.id ?? null);
                            }
                        }}
                        theme={PROOF_THEME}
                    />
                );
            case 'gluten':
                return (
                    <InstrumentCard
                        icon={Gauge}
                        label="Gluten"
                        badge="Dynamics"
                        description="Bus compressor · SSL-style"
                        onClick={() => {
                            if (selectedTrackId) {
                                const device = addDevice(selectedTrackId, 'gluten');
                                showGlutenPanel(device?.id ?? null);
                            }
                        }}
                        theme={GLUTEN_THEME}
                    />
                );
            case 'crust':
                return (
                    <InstrumentCard
                        icon={Layers}
                        label="Crust"
                        badge="Limiter"
                        description="Mastering-grade limiter · 5-level"
                        onClick={() => {
                            if (selectedTrackId) {
                                addDevice(selectedTrackId, 'crust');
                                showCrustPanel(null);
                            }
                        }}
                        theme={CRUST_THEME}
                    />
                );
            case 'dutch-oven':
                return (
                    <InstrumentCard
                        icon={WavesIcon}
                        label="Dutch Oven"
                        badge="Reverb"
                        description="Dattorro plate · FDN · Convolution"
                        onClick={() => {
                            if (selectedTrackId) {
                                addDevice(selectedTrackId, 'dutch-oven');
                                showDutchOvenPanel(null);
                            }
                        }}
                        theme={DUTCH_OVEN_THEME}
                    />
                );
            case 'native-scoring':
                return (
                    <InstrumentCard
                        icon={AudioLines}
                        label="Scoring"
                        badge="Tuner"
                        description="Peterson-grade strobe · Polyphonic"
                        onClick={() => {
                            if (selectedTrackId) {
                                const device = addDevice(selectedTrackId, 'native-scoring');
                                showScoringPanel(device?.id ?? null);
                            }
                        }}
                        theme={SCORING_THEME}
                    />
                );
            case 'grinder':
                return (
                    <InstrumentCard
                        icon={Guitar}
                        label="Grinder"
                        badge="Amp Sim"
                        description="Tube amp · Cabinet · Pedalboard · Neural capture"
                        onClick={() => {
                            if (selectedTrackId) {
                                const device = addDevice(selectedTrackId, 'grinder');
                                showGrinderPanel(device?.id ?? null);
                            }
                        }}
                        theme={GRINDER_THEME}
                    />
                );
            case 'bacteria':
                return (
                    <InstrumentCard
                        icon={Bug}
                        label="Bacteria"
                        badge="Creative FX"
                        description="Multi-band mangler · Distortion · Granular · Spectral"
                        onClick={() => {
                            if (selectedTrackId) {
                                const device = addDevice(selectedTrackId, 'bacteria');
                                showBacteriaPanel(device?.id ?? null);
                            }
                        }}
                        theme={BACTERIA_THEME}
                    />
                );
            case 'yeast':
                return (
                    <InstrumentCard
                        icon={GitBranch}
                        label="Yeast"
                        badge="MIDI FX"
                        description="Arpeggiator · Chord Generator · Scale Filter"
                        onClick={() => {
                            if (selectedTrackId) {
                                addDevice(selectedTrackId, 'Yeast');
                                showYeastPanel(null);
                            }
                        }}
                        theme={YEAST_THEME}
                    />
                );
            default:
                return null;
        }
    };

    if (query) {
        const filteredEffects = effects.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredModulators = MODULATOR_PRESETS.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredMidi = MIDI_EFFECT_FACTORIES.filter((m) => m.name.toLowerCase().includes(query));
        const total =
            filteredEffects.length + filteredFxPresets.length + filteredModulators.length + filteredMidi.length;

        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <SearchSummary count={total} query={query} />
                {total === 0 ? <EmptyState message="No effects found." /> : null}
                {filteredEffects.length > 0 && (
                    <>
                        <DawSectionDivider
                            label="Audio FX"
                            className="mt-1 px-1.5 py-0.5"
                            lineClassName="bg-border/15"
                        />
                        <div className="flex flex-col">
                            {filteredEffects.map((plugin) => {
                                const card = renderPremiumCard(plugin.id);
                                if (card)
                                    return (
                                        <div key={plugin.id} className="mb-1 mt-1.5 px-0.5 drop-shadow-sm">
                                            {card}
                                        </div>
                                    );
                                return <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />;
                            })}
                        </div>
                    </>
                )}
                {filteredFxPresets.length > 0 && (
                    <>
                        <DawSectionDivider
                            label="FX Chain Presets"
                            startSlot={<Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />}
                            className="mt-2 px-1.5 py-0.5"
                            lineClassName="bg-border/15"
                        />
                        <div className="flex flex-col gap-[2px]">
                            {filteredFxPresets.map((preset) => (
                                <PresetItem
                                    key={preset.id}
                                    preset={preset}
                                    selectedTrackId={selectedTrackId}
                                    favorites={favorites}
                                    onToggleFavorite={onToggleFavorite}
                                    onClick={() => handleFxPresetClick(preset)}
                                    preview={preview}
                                />
                            ))}
                        </div>
                    </>
                )}
                <div className="px-1.5 mt-2">
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </div>
            </div>
        );
    }

    if (currentRoute.id === 'effects-fxpresets') {
        return (
            <div className="flex flex-col gap-1.5 animate-in fade-in duration-100">
                {fxPresets.length > 0 ? (
                    fxPresets.map((preset) => (
                        <PresetItem
                            key={preset.id}
                            preset={preset}
                            selectedTrackId={selectedTrackId}
                            favorites={favorites}
                            onToggleFavorite={onToggleFavorite}
                            onClick={() => handleFxPresetClick(preset)}
                            preview={preview}
                        />
                    ))
                ) : (
                    <EmptyState message="No FX chain presets." />
                )}
            </div>
        );
    }

    if (currentRoute.id === 'effects-midifx') {
        return (
            <div className="flex flex-col gap-[2px] animate-in fade-in duration-100">
                <div className="mb-2 px-1.5">{renderPremiumCard('yeast')}</div>
                <EmptyState message="No native MIDI effects available yet." />
            </div>
        );
    }

    if (currentRoute.id === 'effects-modulators') {
        return (
            <div className="flex flex-col gap-[2px] animate-in fade-in duration-100">
                <EmptyState message="Modulators coming soon." />
            </div>
        );
    }

    if (currentRoute.id.startsWith('effects-audiofx-')) {
        const groupId = currentRoute.id.replace('effects-audiofx-', '');
        const items = groupId === 'other' ? uncategorized : (groupedEffects.get(groupId) ?? []);

        // Sort items so premium plugins are pinned to the top
        const sortedItems = [...items].sort((a, b) => {
            const aIsPremium = !!renderPremiumCard(a.id);
            const bIsPremium = !!renderPremiumCard(b.id);
            if (aIsPremium && !bIsPremium) return -1;
            if (!aIsPremium && bIsPremium) return 1;
            return a.name.localeCompare(b.name);
        });

        return (
            <div className="flex flex-col gap-[2px] animate-in fade-in duration-100">
                {sortedItems.length === 0 ? <EmptyState message="Empty category." /> : null}
                {sortedItems.map((plugin) => {
                    const card = renderPremiumCard(plugin.id);
                    if (card)
                        return (
                            <div key={plugin.id} className="mb-3 mt-1.5 px-0.5 drop-shadow-sm">
                                {card}
                            </div>
                        );
                    return <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />;
                })}
            </div>
        );
    }

    if (currentRoute.id === 'effects-audiofx') {
        return (
            <div className="flex flex-col gap-1.5 animate-in fade-in duration-100 px-1.5">
                {visibleEffectGroups.map((group) => {
                    const count = (groupedEffects.get(group.id) ?? []).length;
                    return (
                        <NavCard
                            key={group.id}
                            icon={group.icon}
                            label={group.label}
                            description={group.description}
                            count={count}
                            color={group.color}
                            onClick={() => pushRoute({ id: `effects-audiofx-${group.id}`, title: group.label })}
                        />
                    );
                })}
                {uncategorized.length > 0 && (
                    <NavCard
                        icon={EFFECT_GROUPS[4]!.icon}
                        label="Other"
                        description="Miscellaneous"
                        count={uncategorized.length}
                        color="bg-gray-500/20 text-gray-400"
                        onClick={() => pushRoute({ id: 'effects-audiofx-other', title: 'Other' })}
                    />
                )}
                <div className="pt-1 border-t border-border/20 mt-1">
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-.75 px-1.5 pb-4 animate-in fade-in duration-100">
            <DawSectionDivider
                label="Seeds & Spores"
                className="mb-1 px-1 mt-1"
                labelClassName="font-bold text-[var(--color-accent-orange)]"
                lineClassName="bg-[var(--color-accent-orange)]/15"
            />

            <NavCard
                icon={Waves}
                label="Audio FX"
                description="EQ, dynamics, tone, delay & space"
                count={totalAudioFx}
                color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                onClick={() => pushRoute({ id: 'effects-audiofx', title: 'Audio FX' })}
            />

            {fxPresets.length > 0 && (
                <NavCard
                    icon={Sparkles}
                    label="FX Chain Presets"
                    description="Vocal strips, mastering chains"
                    count={fxPresets.length}
                    color="bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]"
                    onClick={() => pushRoute({ id: 'effects-fxpresets', title: 'FX Chain Presets' })}
                />
            )}

            <DawSectionDivider
                label="Control & Routing"
                className="mb-1 mt-3 px-1"
                labelClassName="text-muted-foreground/50"
                lineClassName="bg-border/15"
            />

            <NavCard
                icon={Sliders}
                label="Modulators"
                description="LFO, envelope, random & macro sources"
                count={MODULATOR_PRESETS.length}
                color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                dimmed
                badge={<SoonBadge />}
                onClick={() => pushRoute({ id: 'effects-modulators', title: 'Modulators' })}
            />

            <NavCard
                icon={Music2}
                label="MIDI FX"
                description="Chord gen, scale filter, quantizer"
                count={MIDI_EFFECT_FACTORIES.length}
                color="bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]"
                dimmed
                onClick={() => pushRoute({ id: 'effects-midifx', title: 'MIDI FX' })}
            />

            <div className="border-t border-border/20 pt-2 mt-1">
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        </div>
    );
};

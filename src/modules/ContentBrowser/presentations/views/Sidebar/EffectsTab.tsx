import { Fragment, type ReactElement } from 'react';

import { Shield, Waves as WavesIcon, Gauge, Sparkles, AudioLines, Layers, Guitar, Bug, GitBranch } from 'lucide-react';

import { logger } from '#/infra/logger/appLogger';
import { compileLoadPresetActions, getFactoryPresets } from '#/modules/Arrangement/useCases';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views';
import { MIDI_EFFECT_FACTORIES } from '#/modules/MIDI/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type PluginDescriptorView as PluginDescriptor } from '../../../models/PluginDescriptorViewTypes';
import { type SoundPresetView as SoundPreset } from '../../../models/SoundPresetViewTypes';
import { executePresetLoad } from '../../../useCases/executePresetLoad';
import { BrowserRouteBody, BrowserRouteFooter, BrowserRouteSection } from '../../components/Sidebar/BrowserRouteBody';
import { EmptyState } from '../../components/Sidebar/EmptyState';
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
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';

import {
    NavCard,
    EffectItem,
    EFFECT_GROUPS,
    addDeviceThroughAction,
    type EffectPlugin,
    Waves,
    Music2,
} from './effectsTabHelpers';
import { type SidebarRoute, type SidebarPanelActions } from './SidebarTypes';

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
    panelActions?: SidebarPanelActions;
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
    panelActions,
}: EffectsTabProps): ReactElement => {
    const isEffectPlugin = (param: EffectPlugin) => param.category !== 'instrument';

    const effects = plugins.filter(isEffectPlugin);
    const query = searchQuery.toLowerCase().trim();

    const fxPresets = getFactoryPresets().filter((param) => FX_PRESET_CATEGORIES.has(param.category));
    const filteredFxPresets = query
        ? fxPresets.filter(
              (param) =>
                  param.name.toLowerCase().includes(query) ||
                  param.tags.some((time) => time.toLowerCase().includes(query))
          )
        : fxPresets;

    const handleFxPresetClick = (preset: SoundPreset) => {
        const plan = compileLoadPresetActions({
            presetId: preset.id,
            ...(selectedTrackId ? { trackId: selectedTrackId } : {}),
        });
        if (!plan) {
            notifyUser('Preset cannot be applied to the current track.', 'error');
            return;
        }
        void executePresetLoad(plan).catch((error) => {
            // The toast names the outcome; the durable log keeps the reason the
            // load was refused diagnosable.
            logger.warn('executePresetLoad failed for FX preset:', error);
            notifyUser('Preset project changes require runtime retry or repair.', 'error');
        });
    };

    const addSelectedTrackDevice = (deviceType: string, afterApplied: (deviceId: string | null) => void): void => {
        addDeviceThroughAction(selectedTrackId, deviceType, afterApplied);
    };

    const groupedEffects = new Map<string, EffectPlugin[]>();
    const uncategorized: EffectPlugin[] = [];

    for (const plugin of effects) {
        const fullId = plugin.id.toLowerCase();
        const idKey = fullId.replace(/^builtin-/, '').replace(/^native-/, '');
        // A category key may name the full catalog id (`native-scoring`), so
        // the unstripped id joins the comparison; `builtin-` ids keep
        // classifying by their stripped key.
        const group = EFFECT_GROUPS.find((g) =>
            g.categories.some((gc) => fullId === gc || fullId.includes(gc) || idKey === gc || idKey.includes(gc))
        );
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
                            addSelectedTrackDevice('Proof', (deviceId) => panelActions?.showProof(deviceId));
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
                            addSelectedTrackDevice('gluten', (deviceId) => panelActions?.showGluten(deviceId));
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
                            addSelectedTrackDevice('crust', (deviceId) => panelActions?.showCrust(deviceId));
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
                            addSelectedTrackDevice('dutch-oven', (deviceId) => panelActions?.showDutchOven(deviceId));
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
                            addSelectedTrackDevice('native-scoring', (deviceId) => panelActions?.showScoring(deviceId));
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
                            addSelectedTrackDevice('grinder', (deviceId) =>
                                panelActions?.showDevice('grinder', deviceId)
                            );
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
                            addSelectedTrackDevice('bacteria', (deviceId) => panelActions?.showBacteria(deviceId));
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
                            // The new device's own id, not `null`: Yeast rack
                            // state is per device instance, so the panel must
                            // open bound to the device it just added
                            // (issue #2422). A refused add opens nothing: a null
                            // id would make the shell fall back to the track's
                            // existing Yeast and open that panel instead.
                            addSelectedTrackDevice('yeast', (deviceId) => {
                                if (deviceId !== null) {
                                    panelActions?.showYeast(deviceId);
                                }
                            });
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
            (param) => param.name.toLowerCase().includes(query) || param.category.toLowerCase().includes(query)
        );
        const filteredMidi = MIDI_EFFECT_FACTORIES.filter((message) => message.name.toLowerCase().includes(query));
        const total = filteredEffects.length + filteredFxPresets.length + filteredMidi.length;

        return (
            <BrowserRouteBody>
                <SearchSummary count={total} query={query} />
                {total === 0 ? <EmptyState message="No effects found." /> : null}
                {filteredEffects.length > 0 ? (
                    <BrowserRouteSection label="Audio FX" lineClassName="bg-border/15">
                        {filteredEffects.map((plugin) => {
                            const card = renderPremiumCard(plugin.id);
                            if (card) {
                                return <Fragment key={plugin.id}>{card}</Fragment>;
                            }
                            return (
                                <EffectItem
                                    key={plugin.id}
                                    plugin={plugin}
                                    selectedTrackId={selectedTrackId}
                                    panelActions={panelActions}
                                />
                            );
                        })}
                    </BrowserRouteSection>
                ) : null}
                {filteredFxPresets.length > 0 ? (
                    <BrowserRouteSection
                        label="FX Chain Presets"
                        startSlot={<Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />}
                        lineClassName="bg-border/15"
                    >
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
                    </BrowserRouteSection>
                ) : null}
                <BrowserRouteFooter>
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </BrowserRouteFooter>
            </BrowserRouteBody>
        );
    }

    if (currentRoute.id === 'effects-fxpresets') {
        return (
            <BrowserRouteBody>
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
            </BrowserRouteBody>
        );
    }

    if (currentRoute.id === 'effects-midifx') {
        return (
            <BrowserRouteBody>
                {renderPremiumCard('yeast')}
                <EmptyState message="No native MIDI effects available yet." />
            </BrowserRouteBody>
        );
    }

    if (currentRoute.id.startsWith('effects-audiofx-')) {
        const groupId = currentRoute.id.replace('effects-audiofx-', '');
        const items = groupId === 'other' ? uncategorized : (groupedEffects.get(groupId) ?? []);

        // Sort items so premium plugins are pinned to the top
        const sortedItems = [...items].sort((alpha, b) => {
            const aIsPremium = !!renderPremiumCard(alpha.id);
            const bIsPremium = !!renderPremiumCard(b.id);
            if (aIsPremium && !bIsPremium) {
                return -1;
            }
            if (!aIsPremium && bIsPremium) {
                return 1;
            }
            return alpha.name.localeCompare(b.name);
        });

        return (
            <BrowserRouteBody>
                {sortedItems.length === 0 ? <EmptyState message="Empty category." /> : null}
                {sortedItems.map((plugin) => {
                    const card = renderPremiumCard(plugin.id);
                    if (card) {
                        return <Fragment key={plugin.id}>{card}</Fragment>;
                    }
                    return (
                        <EffectItem
                            key={plugin.id}
                            plugin={plugin}
                            selectedTrackId={selectedTrackId}
                            panelActions={panelActions}
                        />
                    );
                })}
            </BrowserRouteBody>
        );
    }

    if (currentRoute.id === 'effects-audiofx') {
        return (
            <BrowserRouteBody>
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
                {uncategorized.length > 0 ? (
                    <NavCard
                        icon={EFFECT_GROUPS[4]!.icon}
                        label="Other"
                        description="Miscellaneous"
                        count={uncategorized.length}
                        color="bg-gray-500/20 text-gray-400"
                        onClick={() => pushRoute({ id: 'effects-audiofx-other', title: 'Other' })}
                    />
                ) : null}
                <BrowserRouteFooter>
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </BrowserRouteFooter>
            </BrowserRouteBody>
        );
    }

    return (
        <BrowserRouteBody>
            <BrowserRouteSection
                label="Seeds & Spores"
                labelClassName="font-bold text-[var(--color-accent-orange)]"
                lineClassName="bg-[var(--color-accent-orange)]/15"
            >
                <NavCard
                    icon={Waves}
                    label="Audio FX"
                    description="EQ, dynamics, tone, delay & space"
                    count={totalAudioFx}
                    color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                    onClick={() => pushRoute({ id: 'effects-audiofx', title: 'Audio FX' })}
                />

                {fxPresets.length > 0 ? (
                    <NavCard
                        icon={Sparkles}
                        label="FX Chain Presets"
                        description="Vocal strips, mastering chains"
                        count={fxPresets.length}
                        color="bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]"
                        onClick={() => pushRoute({ id: 'effects-fxpresets', title: 'FX Chain Presets' })}
                    />
                ) : null}
            </BrowserRouteSection>

            <BrowserRouteSection
                label="Control & Routing"
                labelClassName="text-muted-foreground/50"
                lineClassName="bg-border/15"
            >
                <NavCard
                    icon={Music2}
                    label="MIDI FX"
                    description="Chord gen, scale filter, quantizer"
                    count={MIDI_EFFECT_FACTORIES.length}
                    color="bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]"
                    dimmed
                    onClick={() => pushRoute({ id: 'effects-midifx', title: 'MIDI FX' })}
                />
            </BrowserRouteSection>

            <BrowserRouteFooter>
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </BrowserRouteFooter>
        </BrowserRouteBody>
    );
};

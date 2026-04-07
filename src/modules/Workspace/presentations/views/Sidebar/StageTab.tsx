import { type ReactElement } from 'react';
import { Shield, Waves as WavesIcon, Gauge, Sparkles, AudioLines, Layers } from 'lucide-react';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import {
    InstrumentCard,
    PROOF_THEME,
    SCORING_THEME,
    PROOF_CHAMBER_THEME,
    GLUTEN_THEME,
    CRUST_THEME,
} from '../../components/Sidebar/InstrumentCard';
import { eventBus } from '#/app/registerDependencies';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type PluginDescriptorView as PluginDescriptor } from '../../../models/PluginDescriptorViewTypes';
import { type SoundPresetView as SoundPreset } from '../../../models/SoundPresetViewTypes';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { EmptyState } from '../../components/Sidebar/EmptyState';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';
import { NavCard, EffectItem, EFFECT_GROUPS, type EffectPlugin, Waves } from './effectsTabHelpers';

const FX_PRESET_CATEGORIES = new Set(['fx', 'vocal']);

type StageTabProps = {
    plugins: readonly PluginDescriptor[];
    selectedTrackId: string | null;
    searchQuery: string;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
};

export const StageTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    currentRoute,
    pushRoute,
    favorites,
    onToggleFavorite,
    preview,
}: StageTabProps): ReactElement => {
    const premiumIds = new Set(['proof', 'native-scoring', 'native-proof-chamber', 'gluten', 'crust']);

    // Stage plugins are mix utilities, eq, compression, space.
    const isStagePlugin = (p: EffectPlugin) => {
        if (p.category === 'instrument' || premiumIds.has(p.id)) return false;
        if (p.id.startsWith('faust')) return false; // Faust is mostly color
        const idKey = p.id
            .replace(/^builtin-/, '')
            .replace(/^native-/, '')
            .toLowerCase();
        const stageCats = [
            'eq',
            'compressor',
            'sidechain-compressor',
            'limiter',
            'gate',
            'expander',
            'de-esser',
            'reverb',
            'delay',
            'echo',
            'gain',
            'autopan',
            'auto-pan',
            'meter',
            'dc',
            'widener',
            'analyzer',
        ];
        return stageCats.some((c) => idKey.includes(c));
    };

    const effects = plugins.filter(isStagePlugin);
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
        const idKey = plugin.id.replace(/^builtin-/, '').toLowerCase();
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

    if (query) {
        const filteredEffects = effects.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const total = filteredEffects.length + filteredFxPresets.length;

        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <SearchSummary count={total} query={query} />
                {total === 0 ? <EmptyState message="No stage effects found." /> : null}
                {filteredEffects.length > 0 && (
                    <>
                        <DawSectionDivider
                            label="Mix Utilities"
                            className="mt-1 px-1.5 py-0.5"
                            lineClassName="bg-border/15"
                        />
                        <div className="flex flex-col gap-[2px]">
                            {filteredEffects.map((plugin) => (
                                <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                            ))}
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
            </div>
        );
    }

    if (currentRoute.id === 'stage-fxpresets') {
        return (
            <div className="flex flex-col gap-1.5 animate-in slide-in-from-right-4 duration-200">
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

    if (currentRoute.id.startsWith('stage-audiofx-')) {
        const groupId = currentRoute.id.replace('stage-audiofx-', '');
        const items = groupId === 'other' ? uncategorized : (groupedEffects.get(groupId) ?? []);
        return (
            <div className="flex flex-col gap-[2px] animate-in slide-in-from-right-4 duration-200">
                {items.length === 0 ? <EmptyState message="Empty category." /> : null}
                {items.map((plugin) => (
                    <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                ))}
            </div>
        );
    }

    if (currentRoute.id === 'stage-audiofx') {
        return (
            <div className="flex flex-col gap-0 animate-in slide-in-from-right-4 duration-200">
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
                            onClick={() => pushRoute({ id: `stage-audiofx-${group.id}`, title: group.label })}
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
                        onClick={() => pushRoute({ id: 'stage-audiofx-other', title: 'Other' })}
                    />
                )}
                <div className="pt-1 border-t border-border/20 mt-1">
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-0 px-1.5 pb-4 animate-in slide-in-from-left-4 duration-200">
            <div className="flex flex-col gap-1.5 mb-3">
                <DawSectionDivider
                    label="Mastering & Mix"
                    className="mb-0.5 px-1"
                    labelClassName="font-bold text-[var(--color-accent-orange)]"
                    lineClassName="bg-[var(--color-accent-orange)]/15"
                />

                <InstrumentCard
                    icon={Shield}
                    label="Proof"
                    badge="Mastering"
                    description="EQ · Multiband Dynamics · Imager"
                    onClick={() => {
                        if (selectedTrackId) {
                            const device = addDevice(selectedTrackId, 'Proof');
                            void eventBus.emit('panel.showProof', { deviceId: device?.id ?? null });
                        }
                    }}
                    theme={PROOF_THEME}
                />

                <InstrumentCard
                    icon={Gauge}
                    label="Gluten"
                    badge="Dynamics"
                    description="Bus compressor · SSL-style"
                    onClick={() => {
                        if (selectedTrackId) {
                            const device = addDevice(selectedTrackId, 'gluten');
                            void eventBus.emit('panel.showGluten', { deviceId: device?.id ?? null });
                        }
                    }}
                    theme={GLUTEN_THEME}
                />

                <InstrumentCard
                    icon={Layers}
                    label="Crust"
                    badge="Limiter"
                    description="Mastering-grade limiter · 5-level"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'crust');
                            void eventBus.emit('panel.showCrust', { deviceId: null });
                        }
                    }}
                    theme={CRUST_THEME}
                />

                <InstrumentCard
                    icon={WavesIcon}
                    label="Dutch Oven"
                    badge="Reverb"
                    description="Dattorro plate · FDN · Convolution"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'native-proof-chamber');
                            void eventBus.emit('panel.showDutchOven', { deviceId: null });
                        }
                    }}
                    theme={PROOF_CHAMBER_THEME}
                />

                <InstrumentCard
                    icon={AudioLines}
                    label="Scoring"
                    badge="Tuner"
                    description="Peterson-grade strobe · Polyphonic"
                    onClick={() => {
                        if (selectedTrackId) {
                            const device = addDevice(selectedTrackId, 'native-scoring');
                            void eventBus.emit('panel.showScoring', { deviceId: device?.id ?? null });
                        }
                    }}
                    theme={SCORING_THEME}
                />
            </div>

            <DawSectionDivider
                label="Studio Basics"
                className="mb-1 mt-1 px-1"
                labelClassName="text-muted-foreground/50"
                lineClassName="bg-border/15"
            />

            <NavCard
                icon={Waves}
                label="Mix Utilities"
                description="EQ, dynamics, delay & space"
                count={totalAudioFx}
                color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                onClick={() => pushRoute({ id: 'stage-audiofx', title: 'Mix Utilities' })}
            />

            {fxPresets.length > 0 && (
                <NavCard
                    icon={Sparkles}
                    label="FX Chain Presets"
                    description="Vocal strips, mastering chains"
                    count={fxPresets.length}
                    color="bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]"
                    onClick={() => pushRoute({ id: 'stage-fxpresets', title: 'FX Chain Presets' })}
                />
            )}

            <div className="border-t border-border/20 pt-2 mt-1">
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        </div>
    );
};

import { type ReactElement } from 'react';
import { Shield, Mic, Waves as WavesIcon, Gauge, Sparkles, AudioLines, Layers } from 'lucide-react';
import {
    InstrumentCard,
    PROOF_THEME,
    KNEAD_THEME,
    SCORING_THEME,
    PROOF_CHAMBER_THEME,
    GLUTEN_THEME,
    CRUST_THEME,
} from '../../components/Sidebar/InstrumentCard';
import { APP_EVENTS } from '#/helpers/Event/appEvents';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type BUILTIN_PLUGINS, type SoundPreset } from '#/modules/Arrangement/useCases/trackQueries';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';
import {
    NavCard,
    EffectItem,
    EFFECT_GROUPS,
    type EffectPlugin,
    Waves,
} from './effectsTabHelpers';

const FX_PRESET_CATEGORIES = new Set(['fx', 'vocal']);

type StageTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
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
    const premiumIds = new Set(['proof', 'knead', 'native-scoring', 'native-proof-chamber', 'gluten', 'crust']);
    
    // Stage plugins are mix utilities, eq, compression, space.
    const isStagePlugin = (p: EffectPlugin) => {
        if (p.category === 'instrument' || premiumIds.has(p.id)) return false;
        if (p.id.startsWith('faust')) return false; // Faust is mostly color
        const idKey = p.id.replace(/^builtin-/, '').replace(/^native-/, '').toLowerCase();
        const stageCats = ['eq', 'compressor', 'sidechain-compressor', 'limiter', 'gate', 'expander', 'de-esser', 'reverb', 'delay', 'echo', 'gain', 'autopan', 'auto-pan', 'meter', 'dc', 'widener', 'analyzer'];
        return stageCats.some(c => idKey.includes(c));
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
                <div className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest px-1.5 py-0.5">
                    {total} result{total !== 1 ? 's' : ''} for &quot;{query}&quot;
                </div>
                {total === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No stage effects found.</span>
                    </div>
                )}
                {filteredEffects.length > 0 && (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-1">
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Mix Utilities</span>
                        </div>
                        <div className="flex flex-col gap-[2px]">
                            {filteredEffects.map((plugin) => (
                                <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                            ))}
                        </div>
                    </>
                )}
                {filteredFxPresets.length > 0 && (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-2">
                            <Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">FX Chain Presets</span>
                        </div>
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
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No FX chain presets.</span>
                    </div>
                )}
            </div>
        );
    }

    if (currentRoute.id.startsWith('stage-audiofx-')) {
        const groupId = currentRoute.id.replace('stage-audiofx-', '');
        const items = groupId === 'other' ? uncategorized : (groupedEffects.get(groupId) ?? []);
        return (
            <div className="flex flex-col gap-[2px] animate-in slide-in-from-right-4 duration-200">
                {items.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">Empty category.</span>
                    </div>
                )}
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
                <div className="flex items-center gap-1.5 px-1 mb-0.5">
                    <span className="text-[9px] font-bold text-[var(--color-accent-orange)] uppercase tracking-widest">
                        Mastering & Mix
                    </span>
                    <div className="flex-1 h-px bg-[var(--color-accent-orange)]/15" />
                </div>
                
                <InstrumentCard
                    icon={Shield}
                    label="Proof"
                    badge="Mastering"
                    description="EQ · Multiband Dynamics · Imager"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'Proof');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_PROOF_TAB));
                        }
                    }}
                    theme={PROOF_THEME}
                />
                
                <InstrumentCard
                    icon={Mic}
                    label="Knead"
                    badge="Tuning"
                    description="Real-time Pitch Correction"
                    onClick={() => {
                        if (selectedTrackId) addDevice(selectedTrackId, 'Knead');
                    }}
                    theme={KNEAD_THEME}
                />
                
                <InstrumentCard
                    icon={Gauge}
                    label="Gluten"
                    badge="Dynamics"
                    description="Bus compressor · SSL-style"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'gluten');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_GLUTEN_TAB));
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
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_CRUST_TAB));
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
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_PROOF_CHAMBER_TAB));
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
                            addDevice(selectedTrackId, 'native-scoring');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_SCORING_TAB));
                        }
                    }}
                    theme={SCORING_THEME}
                />
            </div>

            <div className="flex items-center gap-1.5 px-1 mb-1 mt-1">
                <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                    Studio Basics
                </span>
                <div className="flex-1 h-px bg-border/15" />
            </div>

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

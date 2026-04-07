import { type ReactElement } from 'react';
import { GitBranch, Bug, Guitar, Sliders, Waves } from 'lucide-react';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import { InstrumentCard, YEAST_THEME, BACTERIA_THEME, GRINDER_THEME } from '../../components/Sidebar/InstrumentCard';
import { eventBus } from '#/app/registerDependencies';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type PluginDescriptorView as PluginDescriptor } from '../../../models/PluginDescriptorViewTypes';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { MODULATOR_PRESETS } from '#/modules/Plugin/useCases/modulatorLibrary';
import { MIDI_EFFECT_FACTORIES } from '#/modules/Plugin/useCases/pluginQueries';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';
import { EmptyState } from '../../components/Sidebar/EmptyState';
import { SearchSummary } from '../../components/Sidebar/SearchSummary';
import { NavCard, EffectItem, SoonBadge, EFFECT_GROUPS, type EffectPlugin, Music2 } from './effectsTabHelpers';

type ColorTabProps = {
    plugins: readonly PluginDescriptor[];
    selectedTrackId: string | null;
    searchQuery: string;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
};

export const ColorTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    currentRoute,
    pushRoute,
}: ColorTabProps): ReactElement => {
    // Premium plugins have their own cards
    const premiumIds = new Set(['bacteria', 'grinder', 'yeast']);

    // Filter out premium and only include color-related plugins
    const isColorPlugin = (p: EffectPlugin) => {
        if (p.category === 'instrument' || premiumIds.has(p.id)) return false;
        if (p.id.startsWith('faust')) return true; // Most faust are color
        const idKey = p.id
            .replace(/^builtin-/, '')
            .replace(/^native-/, '')
            .toLowerCase();
        const colorCats = [
            'distortion',
            'bitcrusher',
            'saturation',
            'overdrive',
            'chorus',
            'flanger',
            'phaser',
            'tremolo',
            'filter',
        ];
        return colorCats.some((c) => idKey.includes(c));
    };

    const effects = plugins.filter(isColorPlugin);
    const query = searchQuery.toLowerCase().trim();

    // Group effects
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

    // Modulators
    const modulatorGroups = new Map<string, typeof MODULATOR_PRESETS>();
    for (const preset of MODULATOR_PRESETS) {
        const key = preset.sourceType ?? 'other';
        const arr = modulatorGroups.get(key) ?? [];
        arr.push(preset);
        modulatorGroups.set(key, arr);
    }

    // Search
    if (query) {
        const filteredEffects = effects.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredModulators = MODULATOR_PRESETS.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredMidi = MIDI_EFFECT_FACTORIES.filter((m) => m.name.toLowerCase().includes(query));
        const total = filteredEffects.length + filteredModulators.length + filteredMidi.length;

        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <SearchSummary count={total} query={query} />
                {total === 0 ? <EmptyState message="No color effects found." /> : null}
                {filteredEffects.length > 0 && (
                    <>
                        <DawSectionDivider
                            label="Tone FX"
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
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        );
    }

    // Route: Audio FX leaf
    if (currentRoute.id.startsWith('color-audiofx-')) {
        const groupId = currentRoute.id.replace('color-audiofx-', '');
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

    // Route: Audio FX groups
    if (currentRoute.id === 'color-audiofx') {
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
                            onClick={() => pushRoute({ id: `color-audiofx-${group.id}`, title: group.label })}
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
                        onClick={() => pushRoute({ id: 'color-audiofx-other', title: 'Other' })}
                    />
                )}
                <div className="pt-1 border-t border-border/20 mt-1">
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </div>
            </div>
        );
    }

    // Root
    return (
        <div className="flex flex-col gap-0 px-1.5 pb-4 animate-in slide-in-from-left-4 duration-200">
            <div className="flex flex-col gap-1.5 mb-3">
                <DawSectionDivider
                    label="Artisan Additives"
                    className="mb-0.5 px-1"
                    labelClassName="font-bold text-[var(--color-accent-orange)]"
                    lineClassName="bg-[var(--color-accent-orange)]/15"
                />

                <InstrumentCard
                    icon={Guitar}
                    label="Grinder"
                    badge="Amp Sim"
                    description="Tube amp · Cabinet · Pedalboard · Neural capture"
                    onClick={() => {
                        if (selectedTrackId) {
                            const device = addDevice(selectedTrackId, 'grinder');
                            void eventBus.emit('panel.showGrinder', { deviceId: device?.id ?? null });
                        }
                    }}
                    theme={GRINDER_THEME}
                />

                <InstrumentCard
                    icon={Bug}
                    label="Bacteria"
                    badge="Creative FX"
                    description="Multi-band mangler · Distortion · Granular · Spectral"
                    onClick={() => {
                        if (selectedTrackId) {
                            const device = addDevice(selectedTrackId, 'bacteria');
                            void eventBus.emit('panel.showBacteria', { deviceId: device?.id ?? null });
                        }
                    }}
                    theme={BACTERIA_THEME}
                />

                <InstrumentCard
                    icon={GitBranch}
                    label="Yeast"
                    badge="MIDI FX"
                    description="Arpeggiator · Chord Generator · Scale Filter"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'Yeast');
                            void eventBus.emit('panel.showYeast', { deviceId: null });
                        }
                    }}
                    theme={YEAST_THEME}
                />
            </div>

            <DawSectionDivider
                label="Spices & Herbs"
                className="mb-1 mt-1 px-1"
                labelClassName="text-muted-foreground/50"
                lineClassName="bg-border/15"
            />

            <NavCard
                icon={Waves}
                label="Tone FX"
                description="Overdrive, chorus, phaser & filters"
                count={totalAudioFx}
                color="bg-[var(--color-state-danger)]/20 text-[var(--color-state-danger)]"
                onClick={() => pushRoute({ id: 'color-audiofx', title: 'Tone FX' })}
            />

            <NavCard
                icon={Sliders}
                label="Modulators"
                description="LFO, envelope, random & macro sources"
                count={MODULATOR_PRESETS.length}
                color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                dimmed
                badge={<SoonBadge />}
                onClick={() => pushRoute({ id: 'color-modulators', title: 'Modulators' })}
            />

            <NavCard
                icon={Music2}
                label="MIDI FX"
                description="Chord gen, scale filter, quantizer"
                count={MIDI_EFFECT_FACTORIES.length}
                color="bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]"
                dimmed
                badge={<SoonBadge />}
                onClick={() => pushRoute({ id: 'color-midifx', title: 'MIDI FX' })}
            />

            <div className="border-t border-border/20 pt-2 mt-1">
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        </div>
    );
};

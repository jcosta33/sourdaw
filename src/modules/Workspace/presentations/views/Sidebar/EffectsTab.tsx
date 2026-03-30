import { type ReactElement } from 'react';
import { Shield, Sparkles, GitBranch, AudioLines, Mic, Waves as WavesIcon, Gauge } from 'lucide-react';
import {
    InstrumentCard,
    PROOF_THEME,
    KNEAD_THEME,
    YEAST_THEME,
    SCORING_THEME,
    PROOF_CHAMBER_THEME,
    GLUTEN_THEME,
} from '../../components/Sidebar/InstrumentCard';
import { APP_EVENTS } from '#/helpers/Event/appEvents';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';
import { type SoundPreset } from '#/modules/Arrangement/useCases/trackQueries';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';
import { createTrackFromPreset, loadPresetToTrack } from '#/modules/Arrangement/useCases/preset/presetLoading';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { MODULATOR_PRESETS } from '#/modules/Plugin/useCases/modulatorLibrary';
import { MIDI_EFFECT_FACTORIES } from '#/modules/Plugin/useCases/pluginQueries';
import { PresetItem } from '../../components/Sidebar/PresetItem';
import { type PreviewHandle } from '../../hooks/usePreviewAudio';
import { type SidebarRoute } from '../Sidebar';
import {
    NavCard,
    EffectItem,
    UnimplementedBadge,
    SoonBadge,
    EFFECT_GROUPS,
    MODULATOR_SOURCE_META,
    type EffectPlugin,
    Waves,
    Sliders,
    Music2,
} from './effectsTabHelpers';

// FX preset categories that live in this tab (moved from Instruments)
const FX_PRESET_CATEGORIES = new Set(['fx', 'vocal']);

// ── Types ────────────────────────────────────────────────────────────────────

type EffectsTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
    favorites: Set<string>;
    onToggleFavorite: (id: string) => void;
    preview: PreviewHandle;
};

// ── Main component ────────────────────────────────────────────────────────────

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
    // Filter out instruments and premium plugins (which have their own hero cards at the top)
    const premiumIds = new Set(['native-proof-chamber', 'native-scoring', 'gluten', 'proof', 'knead', 'yeast']);
    const effects = plugins.filter((p) => p.category !== 'instrument' && !premiumIds.has(p.id));
    const query = searchQuery.toLowerCase().trim();

    // FX chain presets (moved from Instruments tab)
    const fxPresets = getFactoryPresets().filter((p) => FX_PRESET_CATEGORIES.has(p.category));
    const filteredFxPresets = query
        ? fxPresets.filter(
              (p) =>
                  p.name.toLowerCase().includes(query) ||
                  p.category.toLowerCase().includes(query) ||
                  p.tags.some((t) => t.toLowerCase().includes(query))
          )
        : fxPresets;

    const handleFxPresetClick = (preset: SoundPreset) => {
        if (selectedTrackId) {
            loadPresetToTrack(selectedTrackId, preset);
        } else {
            createTrackFromPreset(preset);
        }
    };

    // ── Group effects by EFFECT_GROUPS ──────────────────────────────────────
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

    // ── Modulator presets grouped by sourceType ──────────────────────────────
    const modulatorGroups = new Map<string, typeof MODULATOR_PRESETS>();
    for (const preset of MODULATOR_PRESETS) {
        const key = preset.sourceType ?? 'other';
        const arr = modulatorGroups.get(key) ?? [];
        arr.push(preset);
        modulatorGroups.set(key, arr);
    }

    // ── Search: flat results (no routing) ───────────────────────────────────
    if (query) {
        const filteredEffects = effects.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredModulators = MODULATOR_PRESETS.filter(
            (p) => p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)
        );
        const filteredMidi = MIDI_EFFECT_FACTORIES.filter((m) => m.name.toLowerCase().includes(query));
        const total =
            filteredEffects.length + filteredModulators.length + filteredMidi.length + filteredFxPresets.length;

        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <div className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest px-1.5 py-0.5">
                    {total} result{total !== 1 ? 's' : ''} for &quot;{query}&quot;
                </div>

                {total === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No effects found.</span>
                    </div>
                ) : null}

                {filteredEffects.length > 0 ? (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-1">
                            <Waves className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Audio FX
                            </span>
                        </div>
                        <div className="flex flex-col gap-[2px]">
                            {filteredEffects.map((plugin) => (
                                <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                            ))}
                        </div>
                    </>
                ) : null}

                {filteredModulators.length > 0 ? (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-2">
                            <Sliders className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Modulators
                            </span>
                        </div>
                        <div className="flex flex-col gap-[2px]">
                            {filteredModulators.map((preset) => (
                                <div
                                    key={preset.id}
                                    className="flex items-center justify-between rounded-md px-2 py-1.5 opacity-60 border border-transparent"
                                    title="Not yet implemented — modulators have no audio wiring"
                                >
                                    <span className="text-[11px] font-medium text-foreground/90 truncate flex-1">
                                        {preset.name}
                                    </span>
                                    <UnimplementedBadge />
                                </div>
                            ))}
                        </div>
                    </>
                ) : null}

                {filteredMidi.length > 0 ? (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-2">
                            <Music2 className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                MIDI FX
                            </span>
                        </div>
                        <div className="flex flex-col gap-[2px]">
                            {filteredMidi.map((effect) => (
                                <div
                                    key={effect.id}
                                    className="flex items-center justify-between rounded-md px-2 py-1.5 opacity-60 border border-transparent"
                                    title="Not yet implemented — MIDI FX have no track wiring"
                                >
                                    <span className="text-[11px] font-medium text-foreground/90">{effect.name}</span>
                                    <UnimplementedBadge />
                                </div>
                            ))}
                        </div>
                    </>
                ) : null}

                {filteredFxPresets.length > 0 ? (
                    <>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 mt-2">
                            <Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                                FX Chain Presets
                            </span>
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
                ) : null}

                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        );
    }

    // ── Route: FX chain presets — flat list of all FX/vocal presets ─────────
    if (currentRoute.id === 'effects-fxpresets') {
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

    // ── Route: Audio FX group detail (leaf plugin list) ──────────────────────
    if (currentRoute.id.startsWith('effects-audiofx-')) {
        const groupId = currentRoute.id.replace('effects-audiofx-', '');
        const group = EFFECT_GROUPS.find((g) => g.id === groupId);
        const pluginsInGroup = groupedEffects.get(groupId) ?? [];
        const isUncategorized = groupId === 'other';
        const items = isUncategorized ? uncategorized : pluginsInGroup;

        return (
            <div className="flex flex-col gap-[2px] animate-in slide-in-from-right-4 duration-200">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No effects in this category.</span>
                    </div>
                ) : null}
                {items.map((plugin) => (
                    <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                ))}
                {group ? (
                    <p className="text-[9px] text-muted-foreground/40 px-2 pt-2">
                        Click or drag a plugin to add it to the selected track.
                    </p>
                ) : null}
            </div>
        );
    }

    // ── Route: Audio FX category list ────────────────────────────────────────
    if (currentRoute.id === 'effects-audiofx') {
        return (
            <div className="flex flex-col gap-0 animate-in slide-in-from-right-4 duration-200">
                {visibleEffectGroups.map((group) => {
                    const pluginsInGroup = groupedEffects.get(group.id) ?? [];
                    return (
                        <NavCard
                            key={group.id}
                            icon={group.icon}
                            label={group.label}
                            description={group.description}
                            count={pluginsInGroup.length}
                            color={group.color}
                            onClick={() => pushRoute({ id: `effects-audiofx-${group.id}`, title: group.label })}
                        />
                    );
                })}

                {uncategorized.length > 0 ? (
                    <NavCard
                        icon={EFFECT_GROUPS[4]!.icon}
                        label="Other"
                        description="Miscellaneous effects"
                        count={uncategorized.length}
                        color="bg-gray-500/20 text-gray-400"
                        onClick={() => pushRoute({ id: 'effects-audiofx-other', title: 'Other' })}
                    />
                ) : null}

                <div className="pt-1 border-t border-border/20 mt-1">
                    <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
                </div>
            </div>
        );
    }

    // ── Route: Modulators detail view ────────────────────────────────────────
    if (currentRoute.id.startsWith('effects-modulators-')) {
        const sourceType = currentRoute.id.replace('effects-modulators-', '');
        const presets = modulatorGroups.get(sourceType) ?? [];

        return (
            <div className="flex flex-col gap-[2px] animate-in slide-in-from-right-4 duration-200">
                <div className="flex items-start gap-2 px-2 py-2 rounded-md bg-[var(--color-accent-peach)]/5 border border-[var(--color-accent-peach)]/20 mb-2">
                    <Sparkles
                        className="size-3 text-[var(--color-accent-peach)]/80 shrink-0 mt-0.5"
                        aria-hidden="true"
                    />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Modulation routing exists in the data model but isn't wired to Web Audio yet — clicking a preset
                        has no audio effect.
                    </p>
                </div>
                {presets.map((preset) => (
                    <div
                        key={preset.id}
                        className="flex items-center justify-between rounded-md px-2 py-1.5 border border-transparent opacity-70"
                        title="Not yet implemented — no audio effect"
                    >
                        <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-medium text-foreground/80 block truncate">
                                {preset.name}
                            </span>
                            <span className="text-[9px] text-muted-foreground/50 truncate block leading-none mt-0.5">
                                {preset.category}
                            </span>
                        </div>
                        <UnimplementedBadge />
                    </div>
                ))}
            </div>
        );
    }

    if (currentRoute.id === 'effects-modulators') {
        return (
            <div className="flex flex-col gap-0 animate-in slide-in-from-right-4 duration-200">
                <div className="flex items-start gap-2 px-2 py-2 rounded-md bg-[var(--color-accent-peach)]/5 border border-[var(--color-accent-peach)]/20 mb-2">
                    <Sparkles
                        className="size-3 text-[var(--color-accent-peach)]/80 shrink-0 mt-0.5"
                        aria-hidden="true"
                    />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Modulation routing exists in the data model but isn't wired to Web Audio yet — clicking a preset
                        has no audio effect.
                    </p>
                </div>

                {Array.from(modulatorGroups.entries()).map(([sourceType, presets]) => {
                    const meta = MODULATOR_SOURCE_META[sourceType] ?? {
                        icon: Sliders,
                        color: 'bg-muted/30 text-muted-foreground',
                        label: sourceType,
                    };
                    return (
                        <NavCard
                            key={sourceType}
                            icon={meta.icon}
                            label={meta.label}
                            description=""
                            count={presets.length}
                            color={`${meta.color} opacity-60`}
                            dimmed
                            badge={<SoonBadge />}
                            onClick={() => pushRoute({ id: `effects-modulators-${sourceType}`, title: meta.label })}
                        />
                    );
                })}
            </div>
        );
    }

    // ── Route: MIDI FX detail view ───────────────────────────────────────────
    if (currentRoute.id === 'effects-midifx') {
        return (
            <div className="flex flex-col gap-2 animate-in slide-in-from-right-4 duration-200">
                <div className="flex items-start gap-2 px-2 py-2 rounded-md bg-[var(--color-accent-peach)]/5 border border-[var(--color-accent-peach)]/20">
                    <Sparkles
                        className="size-3 text-[var(--color-accent-peach)]/80 shrink-0 mt-0.5"
                        aria-hidden="true"
                    />
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        MIDI FX logic exists but isn't connected to the MIDI scheduler yet — tracks don't apply these
                        transforms during playback.
                    </p>
                </div>

                <div className="flex flex-col gap-[2px]">
                    {MIDI_EFFECT_FACTORIES.map((effect) => (
                        <div
                            key={effect.id}
                            className="flex items-center justify-between rounded-md px-2 py-1.5 border border-transparent opacity-70"
                            title="Not yet implemented — no MIDI track wiring"
                        >
                            <div className="flex-1 min-w-0">
                                <span className="text-[11px] font-medium text-foreground/80 block">{effect.name}</span>
                            </div>
                            <UnimplementedBadge />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Route: Root — three top-level section cards ──────────────────────────

    return (
        <div className="flex flex-col gap-0 px-1.5 pb-4 animate-in slide-in-from-left-4 duration-200">
            {/* House Specials */}
            <div className="flex flex-col gap-1.5 mb-3">
                <div className="flex items-center gap-1.5 px-1 mb-0.5">
                    <span className="text-[9px] font-bold text-[var(--color-accent-orange)] uppercase tracking-widest">
                        Grain Fusion
                    </span>
                    <div className="flex-1 h-px bg-[var(--color-accent-orange)]/15" />
                </div>
                <InstrumentCard
                    icon={Shield}
                    label="Proof"
                    badge="Mastering"
                    description="EQ · Multiband Dynamics · Imager · Exciter · Limiter"
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
                    description="Real-time Pitch Correction · Formant Shifting"
                    onClick={() => {
                        if (selectedTrackId) addDevice(selectedTrackId, 'Knead');
                    }}
                    theme={KNEAD_THEME}
                />
                <InstrumentCard
                    icon={GitBranch}
                    label="Yeast"
                    badge="MIDI FX"
                    description="Arpeggiator · Chord Generator · Scale Filter"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'Yeast');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_YEAST_TAB));
                        }
                    }}
                    theme={YEAST_THEME}
                />
                <InstrumentCard
                    icon={AudioLines}
                    label="Scoring"
                    badge="Tuner"
                    description="Peterson-grade strobe · Polyphonic strings · YIN + MPM"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'native-scoring');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_SCORING_TAB));
                        }
                    }}
                    theme={SCORING_THEME}
                />
                <InstrumentCard
                    icon={WavesIcon}
                    label="Dutch Oven"
                    badge="Reverb"
                    description="Dattorro plate · FDN · Spring · Convolution · Shimmer"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'native-proof-chamber');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_PROOF_CHAMBER_TAB));
                        }
                    }}
                    theme={PROOF_CHAMBER_THEME}
                />
                <InstrumentCard
                    icon={Gauge}
                    label="Gluten"
                    badge="Dynamics"
                    description="Bus compressor · SSL-style · Parallel compression"
                    onClick={() => {
                        if (selectedTrackId) {
                            addDevice(selectedTrackId, 'gluten');
                            document.dispatchEvent(new Event(APP_EVENTS.SHOW_GLUTEN_TAB));
                        }
                    }}
                    theme={GLUTEN_THEME}
                />
            </div>

            {/* ── The Pantry ── */}
            <div className="flex items-center gap-1.5 px-1 mb-1 mt-1">
                <span className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                    The Pantry
                </span>
                <div className="flex-1 h-px bg-border/15" />
            </div>

            <NavCard
                icon={Waves}
                label="Audio FX"
                description="EQ, dynamics, reverb & drive chains"
                count={totalAudioFx}
                color="bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]"
                onClick={() => pushRoute({ id: 'effects-audiofx', title: 'Audio FX' })}
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
                description="Chord gen, scale filter, quantizer & more"
                count={MIDI_EFFECT_FACTORIES.length}
                color="bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]"
                dimmed
                badge={<SoonBadge />}
                onClick={() => pushRoute({ id: 'effects-midifx', title: 'MIDI FX' })}
            />

            {fxPresets.length > 0 ? (
                <NavCard
                    icon={Sparkles}
                    label="FX Chain Presets"
                    description="Sound design, vocal & mix chains"
                    count={fxPresets.length}
                    color="bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]"
                    onClick={() => pushRoute({ id: 'effects-fxpresets', title: 'FX Chain Presets' })}
                />
            ) : null}

            {/* External Plugin Browser */}
            <div className="border-t border-border/20 pt-2 mt-1">
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        </div>
    );
};

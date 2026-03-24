import { type ReactElement } from 'react';
import {
    Waves,
    Plus,
    Sliders,
    Music2,
    ChevronRight,
    Activity,
    Zap,
    BarChart3,
    Settings2,
    Shuffle,
    TriangleRight,
    GitBranch,
    AlertCircle,
    Sparkles,
} from 'lucide-react';
import { type BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';
import { addDevice } from '#/modules/Arrangement/useCases/deviceUseCases';
import { PluginBrowser } from '#/modules/AudioEngine/presentations/views/PluginBrowser';
import { MODULATOR_PRESETS } from '#/modules/Plugin/useCases/modulatorLibrary';
import { MIDI_EFFECT_FACTORIES } from '#/modules/Plugin/useCases/midiEffectPlugins';
import { type LucideIcon } from 'lucide-react';
import { type SidebarRoute } from '../Sidebar';

// ── Types ────────────────────────────────────────────────────────────────────

type EffectsTabProps = {
    plugins: typeof BUILTIN_PLUGINS;
    selectedTrackId: string | null;
    searchQuery: string;
    currentRoute: SidebarRoute;
    pushRoute: (route: SidebarRoute) => void;
};

type EffectPlugin = (typeof BUILTIN_PLUGINS)[number];

// ── Effect category groups ────────────────────────────────────────────────────

type EffectGroup = {
    id: string;
    label: string;
    description: string;
    icon: LucideIcon;
    color: string;
    categories: string[];
};

const EFFECT_GROUPS: EffectGroup[] = [
    {
        id: 'eq-filter',
        label: 'EQ & Filter',
        description: 'Frequency shaping, cuts & boosts',
        icon: BarChart3,
        color: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
        categories: ['eq', 'filter'],
    },
    {
        id: 'dynamics',
        label: 'Dynamics',
        description: 'Compression, limiting & gating',
        icon: Activity,
        color: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
        categories: ['compressor', 'sidechain-compressor', 'limiter', 'gate', 'expander'],
    },
    {
        id: 'time-space',
        label: 'Time & Space',
        description: 'Reverb, delay & modulation FX',
        icon: Waves,
        color: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
        categories: ['reverb', 'delay', 'chorus', 'flanger', 'phaser', 'tremolo', 'echo'],
    },
    {
        id: 'distortion',
        label: 'Saturation & Drive',
        description: 'Overdrive, saturation & waveshaping',
        icon: Zap,
        color: 'bg-[var(--color-state-danger)]/20 text-[var(--color-state-danger)]',
        categories: ['distortion', 'bitcrusher', 'saturation', 'overdrive'],
    },
    {
        id: 'utility',
        label: 'Utility',
        description: 'Gain, panning & routing tools',
        icon: Settings2,
        color: 'bg-gray-500/20 text-gray-400',
        categories: ['gain', 'autopan', 'auto-pan', 'meter', 'dc'],
    },
];

// ── Modulator source → icon/color ─────────────────────────────────────────────

const MODULATOR_SOURCE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
    lfo: {
        icon: Waves,
        color: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
        label: 'LFO',
    },
    envelope: {
        icon: Activity,
        color: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
        label: 'Envelope',
    },
    random: {
        icon: Shuffle,
        color: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
        label: 'Random',
    },
    step: {
        icon: TriangleRight,
        color: 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]',
        label: 'Step',
    },
    midi: { icon: GitBranch, color: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]', label: 'MIDI' },
};

// ── Shared nav card ──────────────────────────────────────────────────────────

const NavCard = ({
    icon: Icon,
    label,
    description,
    count,
    color,
    dimmed = false,
    badge,
    onClick,
}: {
    icon: LucideIcon;
    label: string;
    description: string;
    count: number;
    color: string;
    dimmed?: boolean;
    badge?: ReactElement;
    onClick: () => void;
}): ReactElement => (
    <button
        type="button"
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-surface-raised border border-transparent hover:border-border/30 transition-all group text-left"
        onClick={onClick}
    >
        <div
            className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md ${color} ${dimmed ? 'opacity-60' : ''}`}
        >
            <Icon className="size-3.5" aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
            <div
                className={`text-[11px] font-medium leading-tight flex items-center gap-1 ${dimmed ? 'text-foreground/60' : 'text-foreground/90'}`}
            >
                {label}
                {badge}
            </div>
            <div className="text-[9px] text-muted-foreground/60 leading-tight truncate mt-0.5">{description}</div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors tabular-nums">
                {count}
            </span>
            <ChevronRight className="size-3.5 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
        </div>
    </button>
);

// ── Effect item (leaf) ────────────────────────────────────────────────────────

const EffectItem = ({
    plugin,
    selectedTrackId,
}: {
    plugin: EffectPlugin;
    selectedTrackId: string | null;
}): ReactElement => (
    <div
        className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-surface-raised border border-transparent hover:border-border/30 transition-all cursor-grab active:cursor-grabbing group"
        draggable
        onDragStart={(e) => {
            e.dataTransfer.setData('application/x-webdaw-plugin', JSON.stringify({ name: plugin.name, id: plugin.id }));
            e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => {
            if (selectedTrackId) {
                addDevice(selectedTrackId, plugin.name);
            }
        }}
        title={selectedTrackId ? `Add "${plugin.name}" to selected track` : 'Drag to a track or select a track first'}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && selectedTrackId) {
                addDevice(selectedTrackId, plugin.name);
            }
        }}
    >
        <div className="flex-1 min-w-0">
            <span className="text-[11px] font-medium text-foreground/90 leading-tight block truncate">
                {plugin.name}
            </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
            <span className="text-[9px] text-muted-foreground/60 tabular-nums">{plugin.parameters.length}p</span>
            {selectedTrackId ? (
                <Plus
                    className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden="true"
                />
            ) : null}
        </div>
    </div>
);

/** Badge shown on unimplemented modulator/MIDI FX items */
const UnimplementedBadge = (): ReactElement => (
    <span
        className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-[var(--color-accent-peach)]/10 text-[var(--color-accent-peach)]/70 shrink-0 ml-1"
        title="Not yet implemented — no audio effect"
    >
        <AlertCircle className="size-2.5" aria-hidden="true" />
        Soon
    </span>
);

const SoonBadge = (): ReactElement => (
    <span className="text-[9px] text-[var(--color-accent-peach)]/60 font-normal">soon</span>
);

// ── Main component ────────────────────────────────────────────────────────────

export const EffectsTab = ({
    plugins,
    selectedTrackId,
    searchQuery,
    currentRoute,
    pushRoute,
}: EffectsTabProps): ReactElement => {
    const effects = plugins.filter((p) => p.category !== 'instrument');
    const query = searchQuery.toLowerCase().trim();

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
        const total = filteredEffects.length + filteredModulators.length + filteredMidi.length;

        return (
            <div className="flex flex-col gap-1 animate-in fade-in duration-150">
                <div className="text-[9px] font-medium text-muted-foreground/70 uppercase tracking-widest px-1.5 py-0.5">
                    {total} result{total !== 1 ? 's' : ''} for &quot;{query}&quot;
                </div>

                {total === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No effects found.</span>
                    </div>
                )}

                {filteredEffects.length > 0 && (
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
                )}

                {filteredModulators.length > 0 && (
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
                )}

                {filteredMidi.length > 0 && (
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
                )}

                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
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
                {items.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 opacity-60">
                        <span className="text-xs text-muted-foreground">No effects in this category.</span>
                    </div>
                )}
                {items.map((plugin) => (
                    <EffectItem key={plugin.id} plugin={plugin} selectedTrackId={selectedTrackId} />
                ))}
                {group && (
                    <p className="text-[9px] text-muted-foreground/40 px-2 pt-2">
                        Click or drag a plugin to add it to the selected track.
                    </p>
                )}
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

                {uncategorized.length > 0 && (
                    <NavCard
                        icon={Settings2}
                        label="Other"
                        description="Miscellaneous effects"
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
        <div className="flex flex-col gap-0 animate-in slide-in-from-left-4 duration-200">
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

            {/* External Plugin Browser */}
            <div className="border-t border-border/20 pt-2 mt-1">
                <PluginBrowser selectedTrackId={selectedTrackId} searchQuery={searchQuery} />
            </div>
        </div>
    );
};

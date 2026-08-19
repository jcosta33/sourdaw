/**
 * Shared components and constants for EffectsTab.
 *
 * Extracted to keep EffectsTab focused on routing/view logic.
 */
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
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';

import { DawChooserCard } from '#/components/daw/DawChooserCard';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { compileAddDeviceAction } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';

import { type PluginDescriptorView as PluginDescriptor } from '../../../models/PluginDescriptorViewTypes';

// ── Types ───────────────────────────────────────────────────────────────────

export type EffectPlugin = PluginDescriptor;

function addDeviceThroughAction(trackId: string, deviceType: string): void {
    const action = compileAddDeviceAction(trackId, deviceType);
    if (action) {
        void executeAppAction(action);
    }
}

export type EffectGroup = {
    id: string;
    label: string;
    description: string;
    icon: LucideIcon;
    color: string;
    categories: string[];
};

// ── Effect category groups ───────────────────────────────────────────────────

export const EFFECT_GROUPS: EffectGroup[] = [
    {
        id: 'eq-filter',
        label: 'EQ & Filter',
        description: 'Frequency shaping, cuts & boosts',
        icon: BarChart3,
        color: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
        categories: ['eq', 'filter', 'proof'],
    },
    {
        id: 'dynamics',
        label: 'Dynamics',
        description: 'Compression, limiting & gating',
        icon: Activity,
        color: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
        categories: [
            'compressor',
            'sidechain-compressor',
            'limiter',
            'gate',
            'expander',
            'de-esser',
            'gluten',
            'crust',
        ],
    },
    {
        id: 'time-space',
        label: 'Time & Space',
        description: 'Reverb, delay & modulation FX',
        icon: Waves,
        color: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
        categories: ['reverb', 'delay', 'chorus', 'flanger', 'phaser', 'tremolo', 'echo', 'dutch-oven'],
    },
    {
        id: 'distortion',
        label: 'Saturation & Drive',
        description: 'Overdrive, saturation & waveshaping',
        icon: Zap,
        color: 'bg-[var(--color-state-danger)]/20 text-[var(--color-state-danger)]',
        categories: ['distortion', 'bitcrusher', 'saturation', 'overdrive', 'grinder', 'bacteria'],
    },
    {
        id: 'utility',
        label: 'Utility',
        description: 'Gain, panning & routing tools',
        icon: Settings2,
        color: 'bg-gray-500/20 text-gray-400',
        categories: ['gain', 'autopan', 'auto-pan', 'meter', 'dc', 'widener', 'native-scoring'],
    },
];

// ── Modulator source → icon/color ────────────────────────────────────────────

export const MODULATOR_SOURCE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
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
    midi: {
        icon: GitBranch,
        color: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
        label: 'MIDI',
    },
};

// ── NavCard ──────────────────────────────────────────────────────────────────

export const NavCard = ({
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
    <DawChooserCard
        compact
        dimmed={dimmed}
        className="group relative overflow-hidden bg-gradient-to-br from-surface-raised to-surface-base border border-border/20 hover:border-border/40 hover:from-surface-overlay hover:to-surface-raised px-2 py-3 mb-1.5 rounded-lg shadow-sm"
        title={label}
        description={description}
        badge={badge}
        startSlot={
            <div
                className={`flex h-8 w-8 items-center justify-center rounded-md ${color} ${dimmed ? 'opacity-60' : ''}`}
            >
                <Icon className="size-4" aria-hidden="true" />
            </div>
        }
        endSlot={
            <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground group-hover:text-foreground/70 transition-colors tabular-nums">
                    {count}
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            </div>
        }
        onClick={onClick}
    />
);

// ── EffectItem ───────────────────────────────────────────────────────────────

/**
 * Adds by `plugin.id`, never by `plugin.name`. `addDevice` matches on name *or*
 * id, and `De-esser`, `LUFS Meter` and `Stereo Widener` each name two catalog
 * plugins — a builtin and a Faust build — so a name lookup returns whichever the
 * registry lists first rather than the card the user clicked or dragged.
 */
export const EffectItem = ({
    plugin,
    selectedTrackId,
}: {
    plugin: EffectPlugin;
    selectedTrackId: string | null;
}): ReactElement => (
    <div
        className="group flex flex-col justify-center rounded-md px-3 py-2.5 bg-gradient-to-br from-surface-raised to-surface-base border border-border/20 hover:border-border/40 hover:from-surface-overlay transition-all cursor-grab active:cursor-grabbing relative overflow-hidden mb-1.5 shadow-sm"
        draggable
        onDragStart={(event) => {
            event.dataTransfer.setData(
                'application/x-sourdaw-plugin',
                JSON.stringify({ name: plugin.name, id: plugin.id })
            );
            event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => {
            if (selectedTrackId) {
                addDeviceThroughAction(selectedTrackId, plugin.id);
            }
        }}
        title={selectedTrackId ? `Add "${plugin.name}" to selected track` : 'Drag to a track or select a track first'}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && selectedTrackId) {
                addDeviceThroughAction(selectedTrackId, plugin.id);
            }
        }}
    >
        <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-semibold text-foreground/90 leading-tight block truncate drop-shadow-sm">
                    {plugin.name}
                </span>
                <span className="text-[10px] text-muted-foreground/70 mt-0.5 capitalize">
                    {plugin.category || 'Effect'}
                </span>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                {selectedTrackId ? (
                    <Plus
                        className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-hidden="true"
                    />
                ) : null}
                <span className="text-[9px] font-medium text-muted-foreground/60 tabular-nums bg-surface-base/50 px-1 rounded">
                    {plugin.parameters.length} params
                </span>
            </div>
        </div>
    </div>
);

// ── UnimplementedBadge ───────────────────────────────────────────────────────

export const UnimplementedBadge = (): ReactElement => (
    <DawMicroBadge
        tone="peach"
        className="ml-1 text-[var(--color-accent-peach)]/70"
        title="Not yet implemented — no audio effect"
    >
        <AlertCircle className="size-2.5" aria-hidden="true" />
        Soon
    </DawMicroBadge>
);

// ── SoonBadge ────────────────────────────────────────────────────────────────

export const SoonBadge = (): ReactElement => (
    <DawMicroBadge
        tone="peach"
        className="border-transparent bg-transparent px-0 text-[var(--color-accent-peach)]/60 shadow-none"
    >
        soon
    </DawMicroBadge>
);

// ── Music2 re-export for EffectsTab convenience ──────────────────────────────
export { Music2, Waves, Sliders };

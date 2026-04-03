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
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';

// ── Types ───────────────────────────────────────────────────────────────────

export type EffectPlugin = (typeof BUILTIN_PLUGINS)[number];

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
        categories: ['eq', 'filter'],
    },
    {
        id: 'dynamics',
        label: 'Dynamics',
        description: 'Compression, limiting & gating',
        icon: Activity,
        color: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
        categories: ['compressor', 'sidechain-compressor', 'limiter', 'gate', 'expander', 'de-esser'],
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
        categories: ['gain', 'autopan', 'auto-pan', 'meter', 'dc', 'widener'],
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

// ── EffectItem ───────────────────────────────────────────────────────────────

export const EffectItem = ({
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
            e.dataTransfer.setData('application/x-sourdaw-plugin', JSON.stringify({ name: plugin.name, id: plugin.id }));
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

// ── UnimplementedBadge ───────────────────────────────────────────────────────

export const UnimplementedBadge = (): ReactElement => (
    <DawMicroBadge tone="peach" className="ml-1 text-[var(--color-accent-peach)]/70" title="Not yet implemented — no audio effect">
        <AlertCircle className="size-2.5" aria-hidden="true" />
        Soon
    </DawMicroBadge>
);

// ── SoonBadge ────────────────────────────────────────────────────────────────

export const SoonBadge = (): ReactElement => (
    <DawMicroBadge tone="peach" className="border-transparent bg-transparent px-0 text-[var(--color-accent-peach)]/60 shadow-none">
        soon
    </DawMicroBadge>
);

// ── Music2 re-export for EffectsTab convenience ──────────────────────────────
export { Music2, Waves, Sliders };

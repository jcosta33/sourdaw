/**
 * Faust Instrument — Dedicated device inspector layout.
 *
 * Groups Faust instrument parameters by semantic category using
 * name-based pattern matching. Shows an instrument identity header
 * with a category badge.
 *
 * Handles ALL faust-* device types via prefix registration.
 */
import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Music, Guitar, Piano, Mic2, Waves, Zap } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    registerPrefixLayout,
} from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';

type DeviceParam = DeviceLayoutProps['parameters'][number];

// ── Instrument metadata by type ──
type InstrumentMeta = { label: string; icon: LucideIcon; color: string };

const INSTRUMENT_META: Record<string, InstrumentMeta> = {
    'faust-rhodes': { label: 'Electric Piano', icon: Piano, color: 'var(--color-accent-amber)' },
    'faust-hammond-b3': { label: 'Tonewheel Organ', icon: Music, color: 'var(--color-accent-coral)' },
    'faust-physical-model-string': { label: 'Physical Modeling', icon: Guitar, color: 'var(--color-accent-teal)' },
    'faust-minimoog': { label: 'Analog Synth', icon: Zap, color: 'var(--color-accent-green)' },
    'faust-fm-synth': { label: 'FM Synthesis', icon: Waves, color: 'var(--color-accent-blue)' },
    'faust-acid-bass-303': { label: 'Acid Bass', icon: Zap, color: 'var(--color-accent-coral)' },
    'faust-supersaw-unison': { label: 'Supersaw', icon: Waves, color: 'var(--color-accent-purple)' },
    'faust-wavetable': { label: 'Wavetable', icon: Waves, color: 'var(--color-accent-blue)' },
    'faust-additive': { label: 'Additive Synth', icon: Music, color: 'var(--color-accent-teal)' },
};

const DEFAULT_META: InstrumentMeta = { label: 'Faust Instrument', icon: Mic2, color: 'var(--color-accent-purple)' };

// ── Semantic categorization by parameter name ──
type ParamCategory = {
    title: string;
    match: (name: string) => boolean;
};

const CATEGORIES: ParamCategory[] = [
    { title: 'Tone', match: (n) => /bright|tone|cutoff|frequency|color|filter|harmonic|timbre/i.test(n) },
    { title: 'Envelope', match: (n) => /attack|decay|sustain|release|adsr|env/i.test(n) },
    { title: 'Modulation', match: (n) => /mod|vibrato|tremolo|lfo|rate|depth|chorus/i.test(n) },
    { title: 'Resonance', match: (n) => /damp|reson|feedback|decay|ring|reverb/i.test(n) },
    { title: 'Output', match: (n) => /gain|volume|level|mix|output|master/i.test(n) },
];

function categorizeParams(params: DeviceParam[]): { title: string; params: DeviceParam[] }[] {
    const result: { title: string; params: DeviceParam[] }[] = [];
    const used = new Set<string>();

    for (const cat of CATEGORIES) {
        const matching = params.filter((p) => cat.match(p.name) && !used.has(p.id));
        if (matching.length > 0) {
            result.push({ title: cat.title, params: matching });
            for (const p of matching) used.add(p.id);
        }
    }

    // Any remaining uncategorized params
    const remaining = params.filter((p) => !used.has(p.id));
    if (remaining.length > 0) {
        result.push({ title: 'Parameters', params: remaining });
    }

    return result;
}

const FaustInstrumentLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const meta = INSTRUMENT_META[device.type ?? ''] ?? DEFAULT_META;
    const Icon = meta.icon;
    const categories = categorizeParams(parameters);

    return (
        <div className="space-y-4">
            {/* ── Instrument Identity Header ── */}
            <div className="flex items-center gap-2 px-1 py-2 rounded-md"
                style={{ background: `color-mix(in srgb, ${meta.color} 8%, transparent)` }}>
                <div
                    className="flex items-center justify-center size-8 rounded"
                    style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}
                >
                    <Icon className="size-4" style={{ color: meta.color }} />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: meta.color }}>
                        {meta.label}
                    </span>
                    <span className="text-[9px] text-muted-foreground truncate">
                        {device.name ?? device.type}
                    </span>
                </div>
            </div>

            {/* ── Categorized Parameter Sections ── */}
            {categories.map(({ title, params }) => (
                <div key={title}>
                    <SectionHeader title={title} />
                    <div className={`grid grid-cols-1 @md:grid-cols-${Math.min(params.length, 3)} gap-2`}>
                        {params.map((param) => (
                            <Card key={param.id} className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full pb-4">
                                <DeviceParameterControl param={param} device={device} trackId={trackId} />
                            </Card>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ── Register for ALL faust-* device types via prefix ──
registerPrefixLayout('faust-', FaustInstrumentLayout);

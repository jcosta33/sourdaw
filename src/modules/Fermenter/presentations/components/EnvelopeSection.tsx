/**
 * Envelope section — visualization-first.
 * Large interactive ADSR as hero (drag breakpoints). Knobs below for precision.
 */
import { type ReactElement, useState } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { ADSREnvelope } from '#/components/daw/visualizers/ADSREnvelope';

type EnvelopeSectionProps = {
    ampA: number; ampD: number; ampS: number; ampR: number;
    filterA: number; filterD: number; filterS: number; filterR: number;
    onAmpChange: (key: 'ampAttack' | 'ampDecay' | 'ampSustain' | 'ampRelease', v: number) => void;
    onFilterChange: (key: 'filterAttack' | 'filterDecay' | 'filterSustain' | 'filterRelease', v: number) => void;
};

export const EnvelopeSection = ({
    ampA, ampD, ampS, ampR, filterA, filterD, filterS, filterR,
    onAmpChange, onFilterChange,
}: EnvelopeSectionProps): ReactElement => {
    const [activeEnv, setActiveEnv] = useState<'amp' | 'filter'>('amp');
    const isAmp = activeEnv === 'amp';
    const a = isAmp ? ampA : filterA;
    const d = isAmp ? ampD : filterD;
    const s = isAmp ? ampS : filterS;
    const r = isAmp ? ampR : filterR;

    const handle = (paramId: string, value: number): void => {
        const prefix = isAmp ? 'amp' : 'filter';
        const map: Record<string, string> = { attack: `${prefix}Attack`, decay: `${prefix}Decay`, sustain: `${prefix}Sustain`, release: `${prefix}Release` };
        const key = map[paramId];
        if (!key) return;
        if (isAmp) onAmpChange(key as 'ampAttack' | 'ampDecay' | 'ampSustain' | 'ampRelease', value);
        else onFilterChange(key as 'filterAttack' | 'filterDecay' | 'filterSustain' | 'filterRelease', value);
    };

    return (
        <div className="space-y-2 w-full max-w-[320px]">
            {/* Header with AMP/FILTER toggle */}
            <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Envelope</span>
                <div className="flex gap-0.5">
                    <button type="button" className={`px-2 py-0.5 rounded text-[8px] font-medium ${isAmp ? 'bg-[var(--color-accent-mint)] text-white' : 'text-muted-foreground/50 hover:text-foreground'}`} onClick={() => setActiveEnv('amp')}>AMP</button>
                    <button type="button" className={`px-2 py-0.5 rounded text-[8px] font-medium ${!isAmp ? 'bg-[var(--color-accent-cyan)] text-white' : 'text-muted-foreground/50 hover:text-foreground'}`} onClick={() => setActiveEnv('filter')}>FILTER</button>
                </div>
            </div>

            {/* HERO: Large interactive ADSR — drag the breakpoints */}
            <div className="rounded-md overflow-hidden border border-border/20 bg-black/20">
                <ADSREnvelope attack={a} decay={d} sustain={s} release={r}
                    color={isAmp ? 'var(--color-accent-mint)' : 'var(--color-accent-cyan)'}
                    width={310} height={100} onParamChange={handle}
                />
            </div>

            {/* Precision knobs */}
            <div className="flex items-end gap-2">
                {[
                    { label: 'A', value: a, key: 'Attack', min: 0.001, max: 5, fmt: `${(a * 1000).toFixed(0)}ms` },
                    { label: 'D', value: d, key: 'Decay', min: 0.001, max: 5, fmt: `${(d * 1000).toFixed(0)}ms` },
                    { label: 'S', value: s, key: 'Sustain', min: 0, max: 1, fmt: `${Math.round(s * 100)}%` },
                    { label: 'R', value: r, key: 'Release', min: 0.001, max: 10, fmt: `${(r * 1000).toFixed(0)}ms` },
                ].map(({ label, value, key, min, max, fmt }) => {
                    const mappedKey = `${isAmp ? 'amp' : 'filter'}${key}` as const;
                    return (
                        <div key={key} className="flex flex-col items-center gap-0">
                            <RotaryKnob paramId={mappedKey} value={value} onChange={(v) => handle(key.toLowerCase(), v)} min={min} max={max} step={key === 'Sustain' ? 0.01 : 0.005} defaultValue={key === 'Sustain' ? 0.7 : 0.2} size="lg" />
                            <span className="text-[7px] text-muted-foreground">{label}</span>
                            <span className="text-[6px] text-muted-foreground/50 font-mono">{fmt}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

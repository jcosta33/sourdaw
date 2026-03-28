/**
 * Envelope section — interactive ADSR for amp and filter envelopes.
 */
import { type ReactElement, useState } from 'react';
import { Card } from '#/components/ui/card';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { ADSREnvelope } from '#/modules/Workspace/presentations/components/ADSREnvelope';

type EnvelopeSectionProps = {
    ampA: number; ampD: number; ampS: number; ampR: number;
    filterA: number; filterD: number; filterS: number; filterR: number;
    onAmpChange: (key: 'ampAttack' | 'ampDecay' | 'ampSustain' | 'ampRelease', v: number) => void;
    onFilterChange: (key: 'filterAttack' | 'filterDecay' | 'filterSustain' | 'filterRelease', v: number) => void;
};

export const EnvelopeSection = ({
    ampA, ampD, ampS, ampR,
    filterA, filterD, filterS, filterR,
    onAmpChange,
    onFilterChange,
}: EnvelopeSectionProps): ReactElement => {
    const [activeEnv, setActiveEnv] = useState<'amp' | 'filter'>('amp');

    const isAmp = activeEnv === 'amp';
    const a = isAmp ? ampA : filterA;
    const d = isAmp ? ampD : filterD;
    const s = isAmp ? ampS : filterS;
    const r = isAmp ? ampR : filterR;

    const handleParamChange = (paramId: string, value: number): void => {
        if (isAmp) {
            if (paramId === 'attack') { onAmpChange('ampAttack', value); }
            if (paramId === 'decay') { onAmpChange('ampDecay', value); }
            if (paramId === 'sustain') { onAmpChange('ampSustain', value); }
            if (paramId === 'release') { onAmpChange('ampRelease', value); }
        } else {
            if (paramId === 'attack') { onFilterChange('filterAttack', value); }
            if (paramId === 'decay') { onFilterChange('filterDecay', value); }
            if (paramId === 'sustain') { onFilterChange('filterSustain', value); }
            if (paramId === 'release') { onFilterChange('filterRelease', value); }
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Envelope</span>
                <div className="flex gap-1 ml-auto">
                    <button
                        type="button"
                        className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${isAmp ? 'bg-[var(--color-accent-teal)] text-white' : 'text-muted-foreground'}`}
                        onClick={() => setActiveEnv('amp')}
                    >
                        AMP
                    </button>
                    <button
                        type="button"
                        className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${!isAmp ? 'bg-[var(--color-accent-cyan)] text-white' : 'text-muted-foreground'}`}
                        onClick={() => setActiveEnv('filter')}
                    >
                        FILTER
                    </button>
                </div>
            </div>

            {/* Interactive ADSR */}
            <div className="flex justify-center">
                <ADSREnvelope
                    attack={a} decay={d} sustain={s} release={r}
                    width={220} height={80}
                    onParamChange={handleParamChange}
                />
            </div>

            {/* ADSR knobs */}
            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: 'Attack', value: a, key: 'attack', max: 5 },
                    { label: 'Decay', value: d, key: 'decay', max: 5 },
                    { label: 'Sustain', value: s, key: 'sustain', max: 1 },
                    { label: 'Release', value: r, key: 'release', max: 10 },
                ].map(({ label, value, key, max }) => (
                    <Card key={key} className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex items-center gap-2">
                        <RotaryKnob
                            value={value}
                            onChange={(v) => handleParamChange(key, v)}
                            min={key === 'sustain' ? 0 : 0.001}
                            max={max}
                            step={key === 'sustain' ? 0.01 : 0.005}
                            defaultValue={key === 'sustain' ? 0.7 : 0.2}
                            size="md"
                        />
                        <div>
                            <div className="text-[9px] font-medium text-foreground/80">{label}</div>
                            <div className="text-[8px] text-muted-foreground font-mono">
                                {key === 'sustain' ? `${Math.round(value * 100)}%` : `${(value * 1000).toFixed(0)}ms`}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};

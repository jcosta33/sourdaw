/**
 * ProofImagerSection — Per-band stereo width controls + correlation meter.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type ProofPatch } from '../../models/ProofPatch';
import { updateProofPatch } from '../../stores/proofStore';
import { setProofParam } from '../../useCases/proofParamBridge';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;

type Props = { patch: ProofPatch; correlation: number; deviceId: string };

export const ProofImagerSection = ({ patch, correlation, deviceId }: Props): ReactElement => {
    const updateWidth = (idx: number, value: number) => {
        const widths: [number, number, number, number] = [...patch.imgBandWidth];
        widths[idx] = value;
        updateProofPatch(deviceId, { imgBandWidth: widths });
        setProofParam(deviceId, `img_width${idx}`, value);
    };

    // Correlation bar color
    const corrColor = correlation > 0.5 ? 'var(--color-accent-mint)'
        : correlation > 0 ? 'var(--color-accent-peach)'
        : 'var(--color-state-danger)';

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <div className="flex items-center justify-between">
                <span className="text-[8px] font-bold text-[var(--color-accent-mint)] uppercase tracking-wider">Stereo Imager</span>
                <button
                    type="button"
                    className={`text-[7px] px-1.5 py-0.5 rounded cursor-pointer ${patch.imgBypassed ? 'text-muted-foreground' : 'text-[var(--color-accent-mint)]'}`}
                    onClick={() => {
                        updateProofPatch(deviceId, { imgBypassed: !patch.imgBypassed });
                        setProofParam(deviceId, 'img_bypass', patch.imgBypassed ? 0 : 1);
                    }}
                >
                    {patch.imgBypassed ? 'OFF' : 'ON'}
                </button>
            </div>

            <div className={`flex flex-col gap-2 ${patch.imgBypassed ? 'opacity-30' : ''}`}>
                {/* Per-band width knobs */}
                <div className="flex justify-around">
                    {BAND_LABELS.map((label, i) => (
                        <div key={i} className="flex flex-col items-center gap-0.5">
                            <span className="text-[7px] text-muted-foreground">{label}</span>
                            <RotaryKnob
                                value={patch.imgBandWidth[i]!}
                                onChange={(v) => updateWidth(i, v)}
                                min={0} max={2} step={0.01} defaultValue={i === 0 ? 0 : 1} size="md"
                            />
                            <span className="text-[7px] text-muted-foreground font-mono">
                                {patch.imgBandWidth[i]! === 0 ? 'Mono' : `${(patch.imgBandWidth[i]! * 100).toFixed(0)}%`}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Auto mono bass */}
                <div className="flex items-center gap-2 px-1">
                    <button
                        type="button"
                        className={`text-[7px] px-1.5 py-0.5 rounded cursor-pointer ${
                            patch.imgAutoMonoBass ? 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]' : 'text-muted-foreground'
                        }`}
                        onClick={() => {
                            updateProofPatch(deviceId, { imgAutoMonoBass: !patch.imgAutoMonoBass });
                            setProofParam(deviceId, 'img_auto_mono_bass', patch.imgAutoMonoBass ? 0 : 1);
                        }}
                    >
                        Auto Mono Bass
                    </button>
                    <RotaryKnob
                        value={patch.imgMonoBassFreq}
                        onChange={(v) => { updateProofPatch(deviceId, { imgMonoBassFreq: v }); setProofParam(deviceId, 'img_mono_bass_freq', v); }}
                        min={40} max={200} step={1} defaultValue={80} size="sm"
                    />
                    <span className="text-[6px] text-muted-foreground font-mono">{patch.imgMonoBassFreq.toFixed(0)} Hz</span>
                </div>

                {/* Correlation meter */}
                <div className="flex items-center gap-2 px-1">
                    <span className="text-[7px] text-muted-foreground shrink-0">Correlation</span>
                    <div className="flex-1 h-2 bg-surface-inset rounded overflow-hidden relative">
                        {/* Center line */}
                        <div className="absolute left-1/2 top-0 w-px h-full bg-border/30" />
                        {/* Bar */}
                        <div
                            className="absolute top-0 h-full rounded transition-all duration-100"
                            style={{
                                backgroundColor: corrColor,
                                left: correlation >= 0
                                    ? '50%'
                                    : `${50 + correlation * 50}%`,
                                width: `${Math.abs(correlation) * 50}%`,
                            }}
                        />
                    </div>
                    <span className="text-[7px] text-muted-foreground font-mono w-8 text-right">{correlation.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

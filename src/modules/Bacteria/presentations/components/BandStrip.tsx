/**
 * BandStrip — per-band channel strip showing enabled effects, solo/mute/gain.
 */
import { type ReactElement } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { type BacteriaBand } from '../../models/BacteriaPatch';

type BandStripProps = {
    index: number;
    band: BacteriaBand;
    isActive: boolean;
    onSelect: () => void;
    onParamChange: (key: string, value: number) => void;
};

const EFFECT_INDICATORS = [
    { key: 'distortionEnabled', label: 'DST', color: 'bg-rose-500' },
    { key: 'filterEnabled', label: 'FLT', color: 'bg-amber-500' },
    { key: 'chorusEnabled', label: 'CHR', color: 'bg-cyan-500' },
    { key: 'granularEnabled', label: 'GRN', color: 'bg-emerald-500' },
    { key: 'spectralEnabled', label: 'SPC', color: 'bg-violet-500' },
    { key: 'freqShiftEnabled', label: 'FSH', color: 'bg-blue-500' },
    { key: 'phaserEnabled', label: 'PHS', color: 'bg-purple-500' },
    { key: 'lofiEnabled', label: 'LFI', color: 'bg-orange-500' },
    { key: 'convolutionEnabled', label: 'BDY', color: 'bg-pink-500' },
] as const;

export const BandStrip = ({ index, band, isActive, onSelect, onParamChange }: BandStripProps): ReactElement => (
    <div
        className={`flex flex-col gap-1 p-1.5 rounded-md border transition-colors cursor-pointer min-w-[70px] ${
            isActive ? 'border-rose-500/40 bg-rose-500/5' : 'border-border/20 hover:border-border/40'
        }`}
        onClick={onSelect}
    >
        {/* Band header */}
        <Row justify="between">
            <span className={`text-[8px] font-bold ${isActive ? 'text-rose-400' : 'text-muted-foreground/60'}`}>
                Band {index + 1}
            </span>
            <Row align="stretch" gap={0.5}>
                <button
                    type="button"
                    className={`w-3.5 h-3.5 rounded text-[5px] font-bold transition-colors ${
                        band.solo ? 'bg-amber-500 text-black' : 'text-muted-foreground/30 hover:text-foreground'
                    }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onParamChange('solo', band.solo ? 0 : 1);
                    }}
                >
                    S
                </button>
                <button
                    type="button"
                    className={`w-3.5 h-3.5 rounded text-[5px] font-bold transition-colors ${
                        band.mute ? 'bg-red-500 text-white' : 'text-muted-foreground/30 hover:text-foreground'
                    }`}
                    onClick={(e) => {
                        e.stopPropagation();
                        onParamChange('mute', band.mute ? 0 : 1);
                    }}
                >
                    M
                </button>
            </Row>
        </Row>

        {/* Effect indicators */}
        <Row align="stretch" wrap gap={0.5}>
            {EFFECT_INDICATORS.map(({ key, label, color }) => (
                <span
                    key={key}
                    className={`text-[5px] px-0.5 rounded font-mono ${
                        band[key] ? `${color} text-white` : 'bg-surface-inset text-muted-foreground/20'
                    }`}
                >
                    {label}
                </span>
            ))}
        </Row>

        {/* Gain knob */}
        <Stack align="center" className="mt-auto">
            <RotaryKnob
                value={band.gain}
                onChange={(v) => onParamChange('gain', v)}
                min={-24}
                max={24}
                step={0.5}
                defaultValue={0}
                size="sm"
                tone="mint"
                aria-label={`Band ${index + 1} gain`}
            />
            <span className="text-[6px] text-muted-foreground/40 font-mono">
                {band.gain > 0 ? '+' : ''}
                {band.gain.toFixed(1)} dB
            </span>
        </Stack>
    </div>
);

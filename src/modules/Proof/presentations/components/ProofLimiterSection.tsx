/**
 * ProofLimiterSection — Look-ahead limiter controls with GR meter + target presets.
 */
import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

const DITHER_MODES = ['Off', 'TPDF', 'Noise Shaped'] as const;
const DITHER_VALUES = ['off', 'tpdf', 'noise_shaped'] as const;

type Props = {
    patch: ProofPatch;
    limiterGrDb: number;
    truePeakDb: number;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofLimiterSection = ({
    patch,
    limiterGrDb,
    truePeakDb,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: Props): ReactElement => {
    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="Limiter"
                size="xs"
                titleClassName="text-[var(--color-state-danger)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.limBypassed}
                        aria-label="Limiter module"
                        tone="danger"
                        size="xs"
                        onClick={() => {
                            const value = !patch.limBypassed;
                            onPatchChange({
                                key: 'limBypassed',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        {patch.limBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            <div className={`flex gap-4 ${patch.limBypassed ? 'opacity-30' : ''}`}>
                {/* Controls */}
                <div className="flex gap-3">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limCeiling}
                            aria-label="Limiter ceiling"
                            onChange={(value, isTransient) => {
                                onPatchChange({
                                    key: 'limCeiling',
                                    value,
                                    isTransient,
                                });
                            }}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={-12}
                            max={0}
                            step={0.1}
                            defaultValue={-1}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Ceiling</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limCeiling.toFixed(1)} dBTP
                        </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limRelease}
                            aria-label="Limiter release"
                            onChange={(value, isTransient) => {
                                onPatchChange({
                                    key: 'limRelease',
                                    value,
                                    isTransient,
                                });
                            }}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={10}
                            max={500}
                            step={1}
                            defaultValue={100}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Release</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limRelease.toFixed(0)} ms
                        </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limLookahead}
                            aria-label="Limiter lookahead"
                            onChange={(value, isTransient) => {
                                onPatchChange({
                                    key: 'limLookahead',
                                    value,
                                    isTransient,
                                });
                            }}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={0.5}
                            max={10}
                            step={0.5}
                            defaultValue={5}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Lookahead</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limLookahead.toFixed(1)} ms
                        </span>
                    </div>
                </div>

                {/* GR + True Peak meters */}
                <div className="flex flex-col gap-1 min-w-[80px]">
                    <div className="flex justify-between text-[7px]">
                        <span className="text-muted-foreground">GR</span>
                        <span className="text-[var(--color-state-danger)] font-mono">{limiterGrDb.toFixed(1)} dB</span>
                    </div>
                    <div className="h-2 bg-surface-inset rounded overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-state-danger)] transition-all duration-75 rounded"
                            style={{ width: `${Math.min(100, (Math.abs(limiterGrDb) / 12) * 100)}%` }}
                        />
                    </div>

                    <div className="flex justify-between text-[7px]">
                        <span className="text-muted-foreground">True Peak</span>
                        <span
                            className={`font-mono ${truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}`}
                        >
                            {truePeakDb > -100 ? `${truePeakDb.toFixed(1)} dBTP` : '-∞'}
                        </span>
                    </div>
                </div>

                {/* Dither */}
                <div className="flex flex-col gap-1">
                    <span className="text-[7px] text-muted-foreground">Dither</span>
                    <DawCompactSelect
                        size="micro"
                        tone="inset"
                        className="text-[7px]"
                        value={DITHER_VALUES.indexOf(patch.ditherMode)}
                        onChange={(event) => {
                            const modeIndex = Number.parseInt(event.target.value, 10);
                            const mode = DITHER_VALUES[modeIndex]!;
                            onPatchChange({
                                key: 'ditherMode',
                                value: mode,
                                isTransient: false,
                            });
                        }}
                    >
                        {DITHER_MODES.map((label, i) => (
                            <option key={label} value={i}>
                                {label}
                            </option>
                        ))}
                    </DawCompactSelect>
                    <div className="flex items-center gap-1">
                        <span className="text-[6px] text-muted-foreground">Bits:</span>
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="text-[6px]"
                            value={patch.ditherBits}
                            onChange={(event) => {
                                const bits = Number.parseInt(event.target.value, 10);
                                onPatchChange({
                                    key: 'ditherBits',
                                    value: bits,
                                    isTransient: false,
                                });
                            }}
                        >
                            <option value={16}>16</option>
                            <option value={24}>24</option>
                        </DawCompactSelect>
                    </div>
                </div>
            </div>
        </div>
    );
};

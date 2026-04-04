/**
 * Spectral warp controls + Audio-rate modulation.
 */
import { type ReactElement } from 'react';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { WARP_MODE_NAMES, AUDIO_MOD_TARGET_NAMES } from '../../models/FermenterPatch';

type WarpSectionProps = {
    warpMode: number;
    warpAmount: number;
    audioModRate: number;
    audioModDepth: number;
    audioModTarget: number;
    onParam: (key: string, value: number) => void;
};

export const WarpSection = ({
    warpMode, warpAmount, audioModRate, audioModDepth, audioModTarget, onParam,
}: WarpSectionProps): ReactElement => (
    <div className="space-y-2">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
            Warp / Mod
        </div>

        {/* Warp mode selector */}
        <div className="space-y-0.5">
            <div className="text-[8px] text-muted-foreground/70 px-1">Spectral Warp</div>
            <div className="flex flex-wrap gap-0.5 px-1">
                {WARP_MODE_NAMES.map((name, i) => (
                    <DawPluginChip
                        key={name}
                        active={warpMode === i}
                        tone="peach"
                        size="xs"
                        onClick={() => onParam('warpMode', i)}
                    >
                        {name}
                    </DawPluginChip>
                ))}
            </div>
            {warpMode > 0 ? (
                <div className="flex items-end gap-2 px-1">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={warpAmount} onChange={(v) => onParam('warpAmount', v)} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                        <span className="text-[7px] text-muted-foreground">Amount</span>
                    </div>
                </div>
            ) : null}
        </div>

        {/* Audio-rate modulation */}
        <div className="space-y-0.5">
            <div className="text-[8px] text-muted-foreground/70 px-1">Audio-Rate Mod</div>
            <div className="flex gap-0.5 px-1">
                {AUDIO_MOD_TARGET_NAMES.map((name, i) => (
                    <DawPluginChip
                        key={name}
                        active={audioModTarget === i}
                        tone="mint"
                        size="xs"
                        onClick={() => onParam('audioModTarget', i)}
                    >
                        {name}
                    </DawPluginChip>
                ))}
            </div>
            {audioModTarget > 0 ? (
                <div className="flex items-end gap-2 px-1">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={audioModRate} onChange={(v) => onParam('audioModRate', v)} min={0} max={5000} step={1} defaultValue={0} size="lg" />
                        <span className="text-[7px] text-muted-foreground">Rate</span>
                        <span className="text-[6px] text-muted-foreground/50 font-mono">
                            {audioModRate < 20 ? `${audioModRate.toFixed(1)}Hz` : audioModRate < 1000 ? `${Math.round(audioModRate)}Hz` : `${(audioModRate / 1000).toFixed(1)}kHz`}
                        </span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={audioModDepth} onChange={(v) => onParam('audioModDepth', v)} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                        <span className="text-[7px] text-muted-foreground">Depth</span>
                    </div>
                </div>
            ) : null}
        </div>
    </div>
);

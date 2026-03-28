/**
 * Effects section — reverb, delay, chorus with per-effect wet/dry.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

type EffectsSectionProps = {
    reverbMix: number;
    reverbDecay: number;
    delayTime: number;
    delayFeedback: number;
    delayMix: number;
    chorusRate: number;
    chorusDepth: number;
    chorusMix: number;
    masterGain: number;
    onParam: (key: string, value: number) => void;
};

export const EffectsSection = ({
    reverbMix,
    reverbDecay,
    delayTime,
    delayFeedback,
    delayMix,
    chorusRate,
    chorusDepth,
    chorusMix,
    masterGain,
    onParam,
}: EffectsSectionProps): ReactElement => {
    return (
        <div className="space-y-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                Effects
            </div>

            {/* Reverb */}
            <div className="space-y-1">
                <div className="text-[9px] text-muted-foreground/70 px-1">Reverb</div>
                <div className="flex items-end gap-2">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={reverbMix} onChange={(v) => onParam('reverbMix', v)} min={0} max={1} step={0.01} defaultValue={0.2} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Mix</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={reverbDecay} onChange={(v) => onParam('reverbDecay', v)} min={0} max={0.99} step={0.01} defaultValue={0.5} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Decay</span>
                    </div>
                </div>
            </div>

            {/* Delay */}
            <div className="space-y-1">
                <div className="text-[9px] text-muted-foreground/70 px-1">Delay</div>
                <div className="flex items-end gap-2">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={delayMix} onChange={(v) => onParam('delayMix', v)} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Mix</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={delayTime} onChange={(v) => onParam('delayTime', v)} min={10} max={2000} step={1} defaultValue={375} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Time</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={delayFeedback} onChange={(v) => onParam('delayFeedback', v)} min={0} max={0.95} step={0.01} defaultValue={0.35} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Fbk</span>
                    </div>
                </div>
            </div>

            {/* Chorus */}
            <div className="space-y-1">
                <div className="text-[9px] text-muted-foreground/70 px-1">Chorus</div>
                <div className="flex items-end gap-2">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={chorusMix} onChange={(v) => onParam('chorusMix', v)} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Mix</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={chorusRate} onChange={(v) => onParam('chorusRate', v)} min={0.1} max={5} step={0.1} defaultValue={1.2} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Rate</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={chorusDepth} onChange={(v) => onParam('chorusDepth', v)} min={0} max={1} step={0.01} defaultValue={0.4} size="lg" />
                        <span className="text-[8px] text-muted-foreground">Depth</span>
                    </div>
                </div>
            </div>

            {/* Master */}
            <div className="pt-1 border-t border-border/20">
                <div className="flex items-end gap-2">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={masterGain} onChange={(v) => onParam('masterGain', v)} min={0} max={2} step={0.01} defaultValue={1} size="xl" />
                        <span className="text-[8px] text-muted-foreground font-medium">Master</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

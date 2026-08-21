/**
 * Unison controls — voice count, detune spread, stereo width.
 */
import { type ReactElement } from 'react';

import { RotaryKnob, type RotaryKnobComponent } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

type UnisonSectionProps = {
    rotaryKnob?: RotaryKnobComponent;
    voices: number;
    detune: number;
    spread: number;
    onVoicesChange: (v: number) => void;
    onDetuneChange: (v: number) => void;
    onSpreadChange: (v: number) => void;
};

export const UnisonSection = ({
    rotaryKnob: Knob = RotaryKnob,
    voices,
    detune,
    spread,
    onVoicesChange,
    onDetuneChange,
    onSpreadChange,
}: UnisonSectionProps): ReactElement => {
    return (
        <Stack gap={2}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">Unison</div>
            <Row align="end" gap={3}>
                <Stack align="center" gap={1}>
                    <Knob
                        paramId="unisonVoices"
                        aria-label="Voices"
                        value={voices}
                        onChange={onVoicesChange}
                        min={1}
                        max={16}
                        step={1}
                        defaultValue={1}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[9px] text-muted-foreground">Voices</span>
                    <span className="text-[8px] text-muted-foreground/60 font-mono">{voices}</span>
                </Stack>
                <Stack align="center" gap={1}>
                    <Knob
                        paramId="unisonDetune"
                        aria-label="Detune"
                        value={detune}
                        onChange={onDetuneChange}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={15}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[9px] text-muted-foreground">Detune</span>
                    <span className="text-[8px] text-muted-foreground/60 font-mono">{Math.round(detune)}ct</span>
                </Stack>
                <Stack align="center" gap={1}>
                    <Knob
                        paramId="unisonSpread"
                        aria-label="Spread"
                        value={spread}
                        onChange={onSpreadChange}
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={0.7}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[9px] text-muted-foreground">Spread</span>
                    <span className="text-[8px] text-muted-foreground/60 font-mono">{Math.round(spread * 100)}%</span>
                </Stack>
            </Row>
        </Stack>
    );
};

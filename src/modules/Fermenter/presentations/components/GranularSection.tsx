/**
 * Granular synthesis controls — density, size, position, spray, pitch variation.
 */
import { type ReactElement } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Stack } from '#/components/layout';

type GranularSectionProps = {
    density: number;
    size: number;
    position: number;
    spray: number;
    pitchVar: number;
    panSpread: number;
    onParam: (key: string, value: number) => void;
};

export const GranularSection = ({
    density,
    size,
    position,
    spray,
    pitchVar,
    panSpread,
    onParam,
}: GranularSectionProps): ReactElement => (
    <Stack gap={2}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">Grain Cloud</div>
        <Grid cols={3} gap={2}>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={density}
                    onChange={(v) => onParam('grainDensity', v)}
                    min={1}
                    max={100}
                    step={1}
                    defaultValue={20}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Density</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{Math.round(density)}g/s</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={size}
                    onChange={(v) => onParam('grainSize', v)}
                    min={5}
                    max={500}
                    step={1}
                    defaultValue={50}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Size</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{Math.round(size)}ms</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={position}
                    onChange={(v) => onParam('grainPosition', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Position</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={spray}
                    onChange={(v) => onParam('grainSpray', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.1}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Spray</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={pitchVar}
                    onChange={(v) => onParam('grainPitchVar', v)}
                    min={0}
                    max={12}
                    step={0.1}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Pitch ±</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{pitchVar.toFixed(1)}st</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={panSpread}
                    onChange={(v) => onParam('grainPanSpread', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Spread</span>
            </Stack>
        </Grid>
    </Stack>
);

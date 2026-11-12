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

type GranularKnobProps = {
    ariaLabel: string;
    label: string;
    value: number;
    param: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    readout?: string;
    onParam: GranularSectionProps['onParam'];
};

const GranularKnob = ({
    ariaLabel,
    label,
    value,
    param,
    min,
    max,
    step,
    defaultValue,
    readout,
    onParam,
}: GranularKnobProps): ReactElement => (
    <Stack align="center" gap={0.5}>
        <RotaryKnob
            aria-label={ariaLabel}
            value={value}
            onChange={(v) => onParam(param, v)}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="lg"
            tone="sage"
        />
        <span className="text-[7px] text-muted-foreground">{label}</span>
        {readout ? <span className="text-[6px] text-muted-foreground/50 font-mono">{readout}</span> : null}
    </Stack>
);

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
            <GranularKnob
                ariaLabel="Granular density"
                label="Density"
                value={density}
                param="grainDensity"
                min={1}
                max={100}
                step={1}
                defaultValue={20}
                readout={`${Math.round(density)}g/s`}
                onParam={onParam}
            />
            <GranularKnob
                ariaLabel="Granular size"
                label="Size"
                value={size}
                param="grainSize"
                min={5}
                max={500}
                step={1}
                defaultValue={50}
                readout={`${Math.round(size)}ms`}
                onParam={onParam}
            />
            <GranularKnob
                ariaLabel="Granular position"
                label="Position"
                value={position}
                param="grainPosition"
                min={0}
                max={1}
                step={0.01}
                defaultValue={0}
                onParam={onParam}
            />
            <GranularKnob
                ariaLabel="Granular spray"
                label="Spray"
                value={spray}
                param="grainSpray"
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.1}
                onParam={onParam}
            />
            <GranularKnob
                ariaLabel="Granular pitch variation"
                label="Pitch ±"
                value={pitchVar}
                param="grainPitchVar"
                min={0}
                max={12}
                step={0.1}
                defaultValue={0}
                readout={`${pitchVar.toFixed(1)}st`}
                onParam={onParam}
            />
            <GranularKnob
                ariaLabel="Granular pan spread"
                label="Spread"
                value={panSpread}
                param="grainPanSpread"
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.5}
                onParam={onParam}
            />
        </Grid>
    </Stack>
);

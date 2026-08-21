/**
 * Morph/layer panel for the Grand Boule piano plugin (spec §3.1).
 *
 * Lets the user pick two piano models, blend between them with a morph
 * knob, adjust layer balance, and toggle the morph engine on/off.
 */

import { type ReactElement } from 'react';

import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import {
    type GrandBouleMorphState,
    type GrandBoulePianoModel,
    BUILTIN_PIANO_MODELS,
} from '../../models/GrandBouleMorphState';

type MorphPanelProps = {
    morph: GrandBouleMorphState;
    onMorphPositionChange: (value: number) => void;
    onLayerBalanceChange: (value: number) => void;
    onModelAChange: (modelId: string) => void;
    onModelBChange: (modelId: string) => void;
    onEnabledChange: (enabled: boolean) => void;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ModelSelector = ({
    label,
    selectedId,
    onSelect,
}: {
    label: string;
    selectedId: string;
    onSelect: (id: string) => void;
}): ReactElement => (
    <Stack gap={1}>
        <div className="text-[8px] uppercase tracking-[0.2em] text-neutral-400/50">{label}</div>
        <Stack gap={0.5}>
            {BUILTIN_PIANO_MODELS.map((model: GrandBoulePianoModel) => {
                const active = model.id === selectedId;
                return (
                    <Button
                        variant="bare"
                        size="bare"
                        key={model.id}
                        type="button"
                        onClick={() => onSelect(model.id)}
                        className={`rounded-sm px-2 py-1 text-left text-[10px] transition-colors ${
                            active
                                ? 'bg-neutral-300/15 text-neutral-200 font-medium'
                                : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                        }`}
                    >
                        {model.name}
                    </Button>
                );
            })}
        </Stack>
    </Stack>
);

const MorphKnob = ({
    value,
    label,
    min,
    max,
    step,
    defaultValue,
    onChange,
    readout,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
}): ReactElement => (
    <Stack align="center" gap={1}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            aria-label={label}
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </Stack>
);

/**
 * A gradient bar that visually represents the morph blend between model A
 * (amber/warm) and model B (sky/bright). The indicator dot tracks the
 * current morph position.
 */
const BlendIndicator = ({
    morphPosition,
    modelAName,
    modelBName,
}: {
    morphPosition: number;
    modelAName: string;
    modelBName: string;
}): ReactElement => (
    <Stack gap={1}>
        <Row justify="between" className="text-[8px] text-muted-foreground/50">
            <span className="truncate max-w-[5rem]">{modelAName}</span>
            <span className="truncate max-w-[5rem] text-right">{modelBName}</span>
        </Row>
        <div className="relative h-2 w-full overflow-hidden rounded-full">
            <div
                className="absolute inset-0 rounded-full"
                style={{
                    background: 'linear-gradient(to right, rgb(217 119 6 / 0.6), rgb(56 189 248 / 0.6))',
                }}
            />
            <div
                className="absolute top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-white shadow-sm shadow-black/40 transition-[left] duration-75"
                style={{ left: `${morphPosition * 100}%` }}
            />
        </div>
    </Stack>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const formatBalance = (value: number): string => {
    if (value < -0.05) {
        return `A ${Math.round(Math.abs(value) * 100)}%`;
    }
    if (value > 0.05) {
        return `B ${Math.round(value * 100)}%`;
    }
    return 'center';
};

export const MorphPanel = ({
    morph,
    onMorphPositionChange,
    onLayerBalanceChange,
    onModelAChange,
    onModelBChange,
    onEnabledChange,
}: MorphPanelProps): ReactElement => {
    const modelA = BUILTIN_PIANO_MODELS.find((m) => m.id === morph.modelA);
    const modelB = BUILTIN_PIANO_MODELS.find((m) => m.id === morph.modelB);

    return (
        <DawPluginSectionCard
            className="grand-boule-window"
            title="Morph"
            detail="Blend between piano models (§3.1)."
            titleClassName="text-neutral-400/80"
        >
            <Stack gap={3}>
                {/* Enable toggle */}
                <Row justify="between" gap={2}>
                    <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/60">
                        Enable morph
                    </span>
                    <DawPluginToggle
                        pressed={morph.enabled}
                        tone="neutral"
                        onClick={() => onEnabledChange(!morph.enabled)}
                    />
                </Row>

                {/* Model selectors */}
                <Grid cols={2} gap={2}>
                    <ModelSelector label="Model A" selectedId={morph.modelA} onSelect={onModelAChange} />
                    <ModelSelector label="Model B" selectedId={morph.modelB} onSelect={onModelBChange} />
                </Grid>

                {/* Blend indicator */}
                <BlendIndicator
                    morphPosition={morph.morphPosition}
                    modelAName={modelA?.name ?? 'A'}
                    modelBName={modelB?.name ?? 'B'}
                />

                {/* Knobs — disabled when morph engine is off */}
                <div
                    className={`grid grid-cols-2 gap-x-2 transition-opacity ${
                        morph.enabled ? '' : 'pointer-events-none opacity-35'
                    }`}
                >
                    <MorphKnob
                        value={morph.morphPosition}
                        onChange={onMorphPositionChange}
                        label="Morph"
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        readout={`${Math.round(morph.morphPosition * 100)}%`}
                    />
                    <MorphKnob
                        value={morph.layerBalance}
                        onChange={onLayerBalanceChange}
                        label="Balance"
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        readout={formatBalance(morph.layerBalance)}
                    />
                </div>
            </Stack>
        </DawPluginSectionCard>
    );
};

/**
 * Layer Stack — shows active layers with selection, mute, and level controls.
 * Part of the Level 3 (Build) experience.
 */
import { type ReactElement } from 'react';

import { Plus, Minus } from 'lucide-react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { ENGINE_NAMES } from '../../models/FermenterPatch';

const LAYER_COLORS = [
    'var(--color-accent-cyan)',
    'var(--color-accent-mint)',
    'var(--color-accent-peach)',
    'var(--color-accent-lavender)',
];

type LayerStackProps = {
    numLayers: number;
    activeLayer: number;
    layerLevel: number;
    layerPan: number;
    currentEngine: number;
    onActiveLayerChange: (layer: number) => void;
    onNumLayersChange: (n: number) => void;
    onLevelChange: (v: number) => void;
    onPanChange: (v: number) => void;
};

type LayerButtonProps = {
    index: number;
    active: boolean;
    currentEngine: number;
    onActiveLayerChange: (layer: number) => void;
};

const LayerButton = ({ index, active, currentEngine, onActiveLayerChange }: LayerButtonProps): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type="button"
        className={`flex items-center gap-2 px-2 py-1 rounded text-left transition-all ${
            active
                ? 'bg-surface-raised border border-border/50'
                : 'hover:bg-surface-raised/50 border border-transparent'
        }`}
        onClick={() => onActiveLayerChange(index)}
    >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: LAYER_COLORS[index] }} />
        <div className="flex-1 min-w-0">
            <div className="text-[9px] font-medium text-foreground">Layer {index + 1}</div>
            <div className="text-[7px] text-muted-foreground/60">
                {active ? (ENGINE_NAMES[currentEngine] ?? 'Wavetable') : '—'}
            </div>
        </div>
        {active ? (
            <div className="w-1 h-4 rounded-full" style={{ backgroundColor: LAYER_COLORS[index], opacity: 0.5 }} />
        ) : null}
    </Button>
);

export const LayerStack = ({
    numLayers,
    activeLayer,
    layerLevel,
    layerPan,
    currentEngine,
    onActiveLayerChange,
    onNumLayersChange,
    onLevelChange,
    onPanChange,
}: LayerStackProps): ReactElement => (
    <Stack gap={1.5}>
        <Row justify="between" className="px-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Layers</div>
            <Row align="stretch" gap={0.5}>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-4 w-4"
                    disabled={numLayers <= 1}
                    onClick={() => onNumLayersChange(numLayers - 1)}
                    aria-label="Decrease layer count"
                >
                    <Minus className="size-2.5" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-4 w-4"
                    disabled={numLayers >= 4}
                    onClick={() => onNumLayersChange(numLayers + 1)}
                    aria-label="Increase layer count"
                >
                    <Plus className="size-2.5" />
                </Button>
            </Row>
        </Row>

        {/* Layer buttons */}
        <Stack gap={0.5}>
            {Array.from({ length: numLayers }, (_, index) => (
                <LayerButton
                    key={index}
                    index={index}
                    active={activeLayer === index}
                    currentEngine={currentEngine}
                    onActiveLayerChange={onActiveLayerChange}
                />
            ))}
        </Stack>

        {/* Active layer level + pan */}
        <Row align="end" gap={2} className="px-1 pt-1 border-t border-border/20">
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    aria-label={`Layer ${activeLayer + 1} level`}
                    value={layerLevel}
                    onChange={onLevelChange}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={1}
                    size="sm"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Level</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    aria-label={`Layer ${activeLayer + 1} pan`}
                    value={layerPan}
                    onChange={onPanChange}
                    min={-1}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="sm"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Pan</span>
            </Stack>
        </Row>
    </Stack>
);

/**
 * Additive synthesis controls — partials, tilt, odd emphasis, inharmonicity.
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Stack } from '#/components/layout';

type AdditiveSectionProps = {
    partials: number;
    tilt: number;
    oddEmphasis: number;
    inharmonicity: number;
    onParam: (key: string, value: number) => void;
};

export const AdditiveSection = ({
    partials,
    tilt,
    oddEmphasis,
    inharmonicity,
    onParam,
}: AdditiveSectionProps): ReactElement => (
    <Stack gap={2}>
        <DawPluginSectionHeader title="Additive" titleClassName="px-1 text-muted-foreground" />
        <div className="text-[8px] text-muted-foreground/60 px-1">
            Sum of sine partials — shape the harmonic spectrum directly.
        </div>
        <Grid cols={2} gap={2}>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={partials}
                    onChange={(v) => onParam('additivePartials', v)}
                    min={1}
                    max={64}
                    step={1}
                    defaultValue={32}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Partials</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{partials}</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={tilt}
                    onChange={(v) => onParam('additiveTilt', v)}
                    min={-6}
                    max={6}
                    step={0.1}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Tilt</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{tilt.toFixed(1)}dB</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={oddEmphasis}
                    onChange={(v) => onParam('additiveOdd', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Odd</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{Math.round(oddEmphasis * 100)}%</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={inharmonicity}
                    onChange={(v) => onParam('additiveInharm', v)}
                    min={0}
                    max={0.1}
                    step={0.001}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[7px] text-muted-foreground">Inharm</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">
                    {(inharmonicity * 1000).toFixed(1)}
                </span>
            </Stack>
        </Grid>
    </Stack>
);

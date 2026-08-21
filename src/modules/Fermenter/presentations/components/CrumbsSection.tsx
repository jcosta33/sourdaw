/**
 * Sampler engine controls — playback mode, start/end points.
 */
import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

const MODE_NAMES = ['One-Shot', 'Loop', 'Ping-Pong'] as const;

type CrumbsSectionProps = {
    mode: number;
    start: number;
    end: number;
    onParam: (key: string, value: number) => void;
};

export const CrumbsSection = ({ mode, start, end, onParam }: CrumbsSectionProps): ReactElement => (
    <Stack gap={2}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">Sampler</div>
        <div className="text-[8px] text-muted-foreground/60 px-1">
            Sample playback with loop modes. Pitch-tracks to MIDI notes.
        </div>
        {/* Mode selector */}
        <Row align="stretch" gap={0.5} className="px-1">
            {MODE_NAMES.map((name, i) => (
                <DawPluginChip
                    key={name}
                    active={mode === i}
                    tone="cyan"
                    size="xs"
                    onClick={() => onParam('samplerMode', i)}
                >
                    {name}
                </DawPluginChip>
            ))}
        </Row>
        {/* Start / End */}
        <Row align="end" gap={3} className="px-1">
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={start}
                    onChange={(v) => onParam('samplerStart', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[8px] text-muted-foreground">Start</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(start * 100)}%</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={end}
                    onChange={(v) => onParam('samplerEnd', v)}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={1}
                    size="lg"
                    tone="sage"
                />
                <span className="text-[8px] text-muted-foreground">End</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(end * 100)}%</span>
            </Stack>
        </Row>
    </Stack>
);

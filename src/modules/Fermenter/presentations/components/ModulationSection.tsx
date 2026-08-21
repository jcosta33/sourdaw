/**
 * Modulation section — MSEG + Step Sequencer controls.
 * This is the beginning of the "Modulation Dock" from the UX spec.
 */
import { type ReactElement } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

type ModulationSectionProps = {
    msegToFilter: number;
    seqRate: number;
    seqToPitch: number;
    onParam: (key: string, value: number) => void;
};

export const ModulationSection = ({
    msegToFilter,
    seqRate,
    seqToPitch,
    onParam,
}: ModulationSectionProps): ReactElement => (
    <Stack gap={2}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">Modulation</div>

        {/* MSEG */}
        <Stack gap={0.5}>
            <div className="text-[8px] text-muted-foreground/70 px-1">MSEG Envelope</div>
            <Row align="end" gap={2} className="px-1">
                <Stack align="center" gap={0.5}>
                    <RotaryKnob
                        value={msegToFilter}
                        onChange={(v) => onParam('msegToFilter', v)}
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[7px] text-muted-foreground">→ Filter</span>
                </Stack>
            </Row>
        </Stack>

        {/* Step Sequencer */}
        <Stack gap={0.5}>
            <div className="text-[8px] text-muted-foreground/70 px-1">Step Sequencer</div>
            <Row align="end" gap={2} className="px-1">
                <Stack align="center" gap={0.5}>
                    <RotaryKnob
                        value={seqRate}
                        onChange={(v) => onParam('seqRate', v)}
                        min={0.5}
                        max={20}
                        step={0.1}
                        defaultValue={4}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[7px] text-muted-foreground">Rate</span>
                    <span className="text-[6px] text-muted-foreground/50 font-mono">{seqRate.toFixed(1)}Hz</span>
                </Stack>
                <Stack align="center" gap={0.5}>
                    <RotaryKnob
                        value={seqToPitch}
                        onChange={(v) => onParam('seqToPitch', v)}
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        size="lg"
                        tone="sage"
                    />
                    <span className="text-[7px] text-muted-foreground">→ Pitch</span>
                </Stack>
            </Row>
        </Stack>
    </Stack>
);

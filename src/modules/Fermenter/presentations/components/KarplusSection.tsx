/**
 * Karplus-Strong physical modeling controls.
 */
import { type ReactElement } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

type KarplusSectionProps = {
    damping: number;
    brightness: number;
    onDampingChange: (v: number) => void;
    onBrightnessChange: (v: number) => void;
};

export const KarplusSection = ({
    damping,
    brightness,
    onDampingChange,
    onBrightnessChange,
}: KarplusSectionProps): ReactElement => (
    <Stack gap={2}>
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">String Model</div>
        <div className="text-[8px] text-muted-foreground/60 px-1">
            Physical string — excitation filtered by damping. Low damping = bright sustained ring, high = dark pluck.
        </div>
        <Row align="end" gap={3}>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={damping}
                    onChange={onDampingChange}
                    min={0}
                    max={0.99}
                    step={0.01}
                    defaultValue={0.5}
                    size="xl"
                    tone="sage"
                />
                <span className="text-[8px] text-muted-foreground">Damping</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{(damping * 100).toFixed(0)}%</span>
            </Stack>
            <Stack align="center" gap={0.5}>
                <RotaryKnob
                    value={brightness}
                    onChange={onBrightnessChange}
                    min={0.1}
                    max={1}
                    step={0.01}
                    defaultValue={0.7}
                    size="xl"
                    tone="sage"
                />
                <span className="text-[8px] text-muted-foreground">Brightness</span>
                <span className="text-[7px] text-muted-foreground/60 font-mono">{(brightness * 100).toFixed(0)}%</span>
            </Stack>
        </Row>
    </Stack>
);

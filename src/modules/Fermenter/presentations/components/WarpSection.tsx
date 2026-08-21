/**
 * Time-domain warp controls + Audio-rate modulation.
 */
import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { WARP_MODE_NAMES, AUDIO_MOD_TARGET_NAMES } from '../../models/FermenterPatch';

type WarpSectionProps = {
    warpMode: number;
    warpAmount: number;
    audioModRate: number;
    audioModDepth: number;
    audioModTarget: number;
    onParam: (key: string, value: number) => void;
};

export const WarpSection = ({
    warpMode,
    warpAmount,
    audioModRate,
    audioModDepth,
    audioModTarget,
    onParam,
}: WarpSectionProps): ReactElement => {
    let audioModRateStr = '';
    if (audioModRate < 20) {
        audioModRateStr = `${audioModRate.toFixed(1)}Hz`;
    } else if (audioModRate < 1000) {
        audioModRateStr = `${Math.round(audioModRate)}Hz`;
    } else {
        audioModRateStr = `${(audioModRate / 1000).toFixed(1)}kHz`;
    }

    const renderIife_1 = () => {
        if (audioModTarget > 0) {
            return (
                <Row align="end" gap={2} className="px-1">
                    <Stack align="center" gap={0.5}>
                        <RotaryKnob
                            value={audioModRate}
                            onChange={(v) => onParam('audioModRate', v)}
                            min={0}
                            max={5000}
                            step={1}
                            defaultValue={0}
                            size="lg"
                            tone="sage"
                        />
                        <span className="text-[7px] text-muted-foreground">Rate</span>
                        <span className="text-[6px] text-muted-foreground/50 font-mono">{audioModRateStr}</span>
                    </Stack>
                    <Stack align="center" gap={0.5}>
                        <RotaryKnob
                            value={audioModDepth}
                            onChange={(v) => onParam('audioModDepth', v)}
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={0}
                            size="lg"
                            tone="sage"
                        />
                        <span className="text-[7px] text-muted-foreground">Depth</span>
                    </Stack>
                </Row>
            );
        } else {
            return null;
        }
    };

    return (
        <Stack gap={2}>
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                Warp / Mod
            </div>

            {/* Warp mode selector */}
            <Stack gap={0.5}>
                <div className="text-[8px] text-muted-foreground/70 px-1">Time-Domain Warp</div>
                <Row align="stretch" wrap gap={0.5} className="px-1">
                    {WARP_MODE_NAMES.map((name, i) => (
                        <DawPluginChip
                            key={name}
                            active={warpMode === i}
                            tone="peach"
                            size="xs"
                            onClick={() => onParam('warpMode', i)}
                        >
                            {name}
                        </DawPluginChip>
                    ))}
                </Row>
                {warpMode > 0 ? (
                    <Row align="end" gap={2} className="px-1">
                        <Stack align="center" gap={0.5}>
                            <RotaryKnob
                                value={warpAmount}
                                onChange={(v) => onParam('warpAmount', v)}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                size="lg"
                                tone="sage"
                            />
                            <span className="text-[7px] text-muted-foreground">Amount</span>
                        </Stack>
                    </Row>
                ) : null}
            </Stack>

            {/* Audio-rate modulation */}
            <Stack gap={0.5}>
                <div className="text-[8px] text-muted-foreground/70 px-1">Audio-Rate Mod</div>
                <Row align="stretch" gap={0.5} className="px-1">
                    {AUDIO_MOD_TARGET_NAMES.map((name, i) => (
                        <DawPluginChip
                            key={name}
                            active={audioModTarget === i}
                            tone="mint"
                            size="xs"
                            onClick={() => onParam('audioModTarget', i)}
                        >
                            {name}
                        </DawPluginChip>
                    ))}
                </Row>
                {renderIife_1()}
            </Stack>
        </Stack>
    );
};

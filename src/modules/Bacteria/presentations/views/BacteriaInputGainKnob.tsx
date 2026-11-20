import { type ReactElement, useLayoutEffect, useState } from 'react';

import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Stack } from '#/components/layout';
import { formatDecibels, GAIN_TRIM_DB } from '#/utils/audioLevelLaw';

import { DEFAULT_PATCH } from '../../models/BacteriaPatch';
import { createBacteriaInputGainControl } from '../../useCases/bacteriaParamBridge/createBacteriaInputGainControl';

export function BacteriaInputGainKnob({
    deviceId,
    committedValue,
}: {
    deviceId: string;
    committedValue: number;
}): ReactElement {
    const [preview, setPreview] = useState<number>();
    const [control] = useState(() => createBacteriaInputGainControl(deviceId, setPreview));
    useLayoutEffect(() => control.connect(), [control]);
    const value = preview ?? committedValue;
    return (
        <Stack
            align="center"
            gap={1}
            className="min-w-[58px]"
            onPointerCancelCapture={control.cancel}
            onLostPointerCaptureCapture={control.cancel}
        >
            <RotaryKnob
                value={value}
                onChange={control.change}
                gestureAuthority={control.gestureAuthority}
                min={GAIN_TRIM_DB.min}
                max={GAIN_TRIM_DB.max}
                step={0.5}
                defaultValue={DEFAULT_PATCH.inputGain}
                size="sm"
                tone="mint"
                paramId="inputGain"
                aria-label="Input"
            />
            <span className="text-micro leading-none text-muted-foreground">Input</span>
            <span className="font-mono text-nano text-muted-foreground">
                {value > 0 ? '+' : ''}
                {formatDecibels(value)}
            </span>
        </Stack>
    );
}

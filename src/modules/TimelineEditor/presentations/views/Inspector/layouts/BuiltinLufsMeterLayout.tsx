/**
 * Builtin LUFS Meter layout — loudness readouts for `builtin-lufs-meter`.
 *
 * The device measures continuously in the engine; the readings arrive through
 * `getBuiltinLufsMeterReading` at animation rate, throttled to ~10 fps React
 * state updates — the same contract as the Faust LUFS meter layout. The
 * `lufs-window` setting selects which window the engine measures; `lufs-target`
 * is a reference the panel shows as a fixed row.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Stack } from '#/components/layout';
import { getBuiltinLufsMeterReading } from '#/modules/AudioEngine/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, registerDeviceLayout } from '../deviceLayoutRegistry';
import { SectionHeader } from '../SectionHeader';

/** Reading shape derived from the AudioEngine use case's own contract. */
type LufsReading = NonNullable<ReturnType<typeof getBuiltinLufsMeterReading>>;
type LufsWindow = LufsReading['window'];

/** ms between React state updates; rAF still polls every frame. */
const STATE_UPDATE_INTERVAL = 100;

const READOUT_WINDOWS: ReadonlyArray<{ window: LufsWindow; label: string }> = [
    { window: 'momentary', label: 'Momentary (LUFS)' },
    { window: 'shortTerm', label: 'Short-Term (LUFS)' },
    { window: 'integrated', label: 'Integrated (LUFS)' },
];

const NO_READINGS: Record<LufsWindow, number | null> = {
    momentary: null,
    shortTerm: null,
    integrated: null,
};

function formatReading(value: number | null): string {
    if (value === null) {
        return '—';
    }
    return `${value.toFixed(1)} LUFS`;
}

const BuiltinLufsMeterLayout = ({ device, parameters }: DeviceLayoutProps): ReactElement => {
    const [readings, setReadings] = useState<Record<LufsWindow, number | null>>(NO_READINGS);

    const targetValue = parameters.find((parameter) => parameter.id === 'lufs-target')?.value;

    useEffect(() => {
        let rafId = 0;
        // -Infinity: "never updated yet", so the first poll paints immediately.
        let lastStateUpdate = -Infinity;

        const poll = (): void => {
            const now = performance.now();
            if (now - lastStateUpdate > STATE_UPDATE_INTERVAL) {
                const reading = getBuiltinLufsMeterReading(device.id);
                setReadings({
                    momentary: reading?.momentary ?? null,
                    shortTerm: reading?.shortTerm ?? null,
                    integrated: reading?.integrated ?? null,
                });
                lastStateUpdate = now;
            }
            rafId = requestAnimationFrame(poll);
        };
        poll();
        return () => cancelAnimationFrame(rafId);
    }, [device.id]);

    return (
        <Stack gap={3}>
            <SectionHeader title="Loudness" />
            <SurfaceCard className="rounded-md bg-surface-base p-2">
                <Stack gap={2}>
                    {READOUT_WINDOWS.map(({ window, label }) => (
                        <DawReadoutRow
                            key={window}
                            label={label}
                            value={formatReading(readings[window])}
                            data-testid={`builtin-lufs-reading-${window}`}
                            valueClassName="text-[11px] text-foreground"
                        />
                    ))}
                    {targetValue !== undefined && (
                        <DawReadoutRow
                            label="Target"
                            value={`${targetValue.toFixed(1)} LUFS`}
                            data-testid="builtin-lufs-target"
                            valueClassName="text-[11px] text-foreground"
                        />
                    )}
                </Stack>
            </SurfaceCard>
        </Stack>
    );
};

registerDeviceLayout('builtin-lufs-meter', BuiltinLufsMeterLayout);

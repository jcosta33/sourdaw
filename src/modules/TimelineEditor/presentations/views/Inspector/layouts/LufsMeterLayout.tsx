/**
 * LUFS Meter layout — read-only loudness readouts for the Faust LUFS Meter.
 *
 * The device's momentary and short-term loudness are Faust vbargraph outputs:
 * readings, not controls, so they arrive through the engine's bargraph bridge
 * (`getFaustMeterReading`) rather than a parameter. Polled on requestAnimationFrame
 * with React state throttled to ~10 fps, the same contract as the master
 * `LUFSMeter` view — a meter tick must never be a re-render per reading.
 */
import { type ReactElement, useEffect, useState } from 'react';

import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Stack } from '#/components/layout';
import { getFaustMeterReading } from '#/modules/AudioEngine/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, registerDeviceLayout } from '../deviceLayoutRegistry';
import { SectionHeader } from '../SectionHeader';

/** The LUFS Meter DSP's silence floor: `lufs(ms)` returns -70 below 1e-10 ms. */
const LUFS_FLOOR = -70;

/** ms between React state updates; rAF still polls every frame. */
const STATE_UPDATE_INTERVAL = 100;

type ReadoutKey = 'momentary' | 'short_term';

const READOUTS: ReadonlyArray<{ paramId: ReadoutKey; label: string }> = [
    { paramId: 'momentary', label: 'Momentary (LUFS)' },
    { paramId: 'short_term', label: 'Short-Term (LUFS)' },
];

function formatReading(value: number | null): string {
    if (value === null) {
        return '—';
    }
    return `${value > LUFS_FLOOR ? value.toFixed(1) : '-∞'} LUFS`;
}

const LufsMeterLayout = ({ device }: DeviceLayoutProps): ReactElement => {
    const [readings, setReadings] = useState<Record<ReadoutKey, number | null>>({
        momentary: null,
        short_term: null,
    });

    useEffect(() => {
        let rafId = 0;
        // -Infinity: "never updated yet", so the first poll paints immediately.
        let lastStateUpdate = -Infinity;

        const poll = (): void => {
            const now = performance.now();
            if (now - lastStateUpdate > STATE_UPDATE_INTERVAL) {
                setReadings({
                    momentary: getFaustMeterReading(device.id, 'momentary'),
                    short_term: getFaustMeterReading(device.id, 'short_term'),
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
                    {READOUTS.map(({ paramId, label }) => (
                        <DawReadoutRow
                            key={paramId}
                            label={label}
                            value={formatReading(readings[paramId])}
                            data-testid={`lufs-reading-${paramId}`}
                            valueClassName="text-[11px] text-foreground"
                        />
                    ))}
                </Stack>
            </SurfaceCard>
        </Stack>
    );
};

// Exact registration: resolveDeviceLayout checks exact ids before the `faust-`
// prefix family, so this claims the analyzer back from FaustInstrumentLayout,
// which otherwise renders it as an instrument waiting for parameters that a
// meter never has.
registerDeviceLayout('faust-lufs-meter', LufsMeterLayout);

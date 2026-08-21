/**
 * CrustMeteringStrip — right panel: L/R output meters, GR meter, LUFS readouts, TP LED.
 */
import { type ReactElement } from 'react';

import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginReadoutList } from '#/components/daw/DawPluginReadoutList';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { grColor } from './crustMeterColors';

type Props = {
    grDb: number;
    outputDb: number;
    lufsIntegrated: number;
    lufsShortTerm: number;
    lufsMomentary: number;
    lra: number;
    truepeakMax: number;
    truepeakExceeded: boolean;
    lufsTarget: number | null;
    onResetTp: () => void;
};

function dbToNorm(db: number, min = -60, max = 6): number {
    return Math.max(0, Math.min(1, (db - min) / (max - min)));
}

function lufsColor(lufs: number, target: number | null): string {
    if (target === null) {
        return '#E8E6E0';
    }
    const diff = lufs - target;
    if (Math.abs(diff) <= 0.5) {
        return '#7FC8A0';
    }
    if (lufs > target) {
        return '#C44030';
    }
    return '#E8E6E0';
}

const MeterBar = ({ value, id }: { value: number; id: string }): ReactElement => {
    let color: string;
    if (value > 0.9) {
        color = '#C44030';
    } else if (value > 0.7) {
        color = '#D4A847';
    } else {
        color = '#4A9ECC';
    }
    return (
        <div
            id={id}
            className="relative flex-1"
            style={{ background: '#1E1E22', borderRadius: 2, overflow: 'hidden', minHeight: 60 }}
            role="meter"
            aria-valuenow={Math.round(value * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className="absolute bottom-0 left-0 right-0 transition-none"
                style={{ height: `${value * 100}%`, background: color, borderRadius: 2 }}
            />
        </div>
    );
};

const MeterSection = ({
    title,
    children,
    actions,
    className = '',
}: {
    title: string;
    children: ReactElement | ReactElement[];
    actions?: ReactElement;
    className?: string;
}): ReactElement => (
    <section className={`rounded-[14px] border border-white/8 bg-black/[0.22] px-3 py-2 ${className}`}>
        <DawPluginSectionHeader
            title={title}
            actions={actions}
            size="xs"
            titleClassName="text-muted-foreground/70"
            className="mb-2"
        />
        {children}
    </section>
);

export const CrustMeteringStrip = ({
    grDb,
    outputDb,
    lufsIntegrated,
    lufsShortTerm,
    lufsMomentary,
    lra,
    truepeakMax,
    truepeakExceeded,
    lufsTarget,
    onResetTp,
}: Props): ReactElement => {
    const outNorm = dbToNorm(outputDb);
    const grNorm = Math.min(1, Math.max(0, Math.abs(grDb) / 18));
    const intColor = lufsColor(lufsIntegrated, lufsTarget);
    const grc = grColor(grDb);

    const targetDiff = lufsTarget !== null ? lufsIntegrated - lufsTarget : null;

    let targetDiffColor = '#D4A847';
    if (targetDiff !== null) {
        if (Math.abs(targetDiff) <= 0.5) {
            targetDiffColor = '#7FC8A0';
        } else if (targetDiff > 0) {
            targetDiffColor = '#C44030';
        }
    }

    return (
        <Stack
            gap={2}
            className="p-2 h-full"
            style={{
                width: 160,
                minWidth: 160,
                background: '#0E0E10',
                borderLeft: '1px solid rgba(46,46,54,0.5)',
            }}
        >
            <MeterSection title="Output">
                <Row align="stretch" gap={1} className="h-16">
                    <MeterBar value={outNorm} id="crust-meter-l" />
                    <MeterBar value={outNorm * 0.97} id="crust-meter-r" />
                    <div
                        className="relative"
                        style={{ width: 12, background: '#1E1E22', borderRadius: 2, overflow: 'hidden' }}
                        title={`GR: ${grDb.toFixed(1)} dB`}
                    >
                        <div
                            className="absolute top-0 left-0 right-0 transition-none"
                            style={{ height: `${grNorm * 100}%`, background: grc, borderRadius: 2 }}
                        />
                    </div>
                </Row>
                <Row align="stretch" justify="between" className="mt-0.5">
                    <span className="text-[7px] font-mono text-muted-foreground/50">L</span>
                    <span
                        className="text-[7px] font-mono"
                        style={{ color: grc }}
                        aria-label={`Gain reduction: ${Math.abs(grDb).toFixed(1)} dB`}
                    >
                        GR
                    </span>
                    <span className="text-[7px] font-mono text-muted-foreground/50">R</span>
                </Row>
            </MeterSection>

            <MeterSection title="Loudness" className="flex-1">
                <div className="mb-1">
                    <span
                        className="font-mono font-bold tabular-nums"
                        style={{ fontSize: 20, color: intColor, letterSpacing: '-0.02em' }}
                        aria-label={`Integrated LUFS: ${lufsIntegrated.toFixed(1)}`}
                    >
                        {lufsIntegrated > -99 ? lufsIntegrated.toFixed(1) : '—'}
                    </span>
                    <span className="text-[8px] text-muted-foreground/50 ml-1">LUFS</span>
                    {targetDiff !== null ? (
                        <span
                            className="text-[8px] font-mono ml-1"
                            style={{
                                color: targetDiffColor,
                            }}
                        >
                            ({targetDiff > 0 ? '+' : ''}
                            {targetDiff.toFixed(1)})
                        </span>
                    ) : null}
                </div>

                <DawPluginReadoutList density="tight">
                    <DawReadoutRow
                        label="ST"
                        value={lufsShortTerm > -99 ? lufsShortTerm.toFixed(1) : '—'}
                        aria-label={`Short-term LUFS: ${lufsShortTerm.toFixed(1)}`}
                        labelClassName="text-[7px] text-muted-foreground/40"
                        valueClassName="text-[12px] tabular-nums text-foreground/70"
                    />
                    <DawReadoutRow
                        label="MOM"
                        value={lufsMomentary > -99 ? lufsMomentary.toFixed(1) : '—'}
                        aria-label={`Momentary LUFS: ${lufsMomentary.toFixed(1)}`}
                        labelClassName="text-[7px] text-muted-foreground/40"
                        valueClassName="text-[12px] tabular-nums text-foreground/70"
                    />
                </DawPluginReadoutList>

                <div className="mt-1 pt-1 border-t border-border/10">
                    <DawReadoutRow
                        label="LRA"
                        value={`${lra.toFixed(1)} LU`}
                        aria-label={`Loudness range: ${lra.toFixed(1)} LU`}
                        labelClassName="text-[7px] text-muted-foreground/40"
                        valueClassName="text-[10px] text-foreground/60"
                    />
                </div>
            </MeterSection>

            <MeterSection
                title="TP max"
                actions={
                    <Button
                        variant="bare"
                        size="bare"
                        type="button"
                        onClick={onResetTp}
                        aria-label="Reset true peak indicator"
                        title="Reset true peak indicator"
                        className="size-2 rounded-full border-0 bg-[var(--color-state-success)] p-0"
                        style={{ background: truepeakExceeded ? '#C44030' : '#4A7C6F', cursor: 'pointer' }}
                    />
                }
            >
                <Row justify="between">
                    <Row gap={1}>
                        <span
                            className="text-[9px] font-mono"
                            style={{ color: truepeakExceeded ? '#C44030' : '#E8E6E0' }}
                        >
                            {truepeakMax > -99 ? truepeakMax.toFixed(1) : '—'}
                        </span>
                        <DawPluginLed tone={truepeakExceeded ? 'danger' : 'neutral'}>
                            {truepeakExceeded ? 'Clip' : 'Clear'}
                        </DawPluginLed>
                    </Row>
                </Row>
            </MeterSection>
        </Stack>
    );
};

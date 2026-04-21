/**
 * MIDI Controller Calibration Panel for Grand Boule (spec SS3.1).
 *
 * Provides rotary knobs for all six calibration parameters, a real-time
 * velocity histogram rendered on a canvas, a "last velocity" metric tile,
 * and a reset-defaults chip button. Uses the amber accent palette to
 * match the Grand Boule faceplate theme.
 */

import { type ReactElement, useEffect, useRef, useState } from 'react';

import { RotateCcw } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

import { type GrandBouleMidiCalibration, MIDI_CALIBRATION_RANGES } from '../../models/GrandBouleMidiCalibration';

// ---------------------------------------------------------------------------
// Velocity histogram constants
// ---------------------------------------------------------------------------

const HISTOGRAM_BINS = 16;
const HISTOGRAM_MAX_SAMPLES = 128;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const Knob = ({
    value,
    label,
    min,
    max,
    step,
    defaultValue,
    onChange,
    readout,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </div>
);

// ---------------------------------------------------------------------------
// Velocity Histogram (canvas bar chart)
// ---------------------------------------------------------------------------

const VelocityHistogram = ({ samples }: { samples: ReadonlyArray<number> }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }

        const dpr = window.devicePixelRatio;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;

        // Bucket velocities into bins (0..127 -> 0..HISTOGRAM_BINS-1)
        const bins = new Uint32Array(HISTOGRAM_BINS);
        for (const v of samples) {
            const idx = Math.min(HISTOGRAM_BINS - 1, Math.floor((v / 128) * HISTOGRAM_BINS));
            bins[idx] = (bins[idx] ?? 0) + 1;
        }

        const peak = Math.max(1, ...bins);

        ctx.clearRect(0, 0, w, h);

        const barGap = 1.5;
        const barWidth = (w - barGap * (HISTOGRAM_BINS - 1)) / HISTOGRAM_BINS;

        for (let i = 0; i < HISTOGRAM_BINS; i += 1) {
            const count = bins[i] ?? 0;
            const barHeight = (count / peak) * (h - 4);
            const x = i * (barWidth + barGap);
            const y = h - barHeight;

            // Amber gradient intensity based on bin position (louder = brighter)
            const intensity = 0.3 + 0.7 * (i / (HISTOGRAM_BINS - 1));
            ctx.fillStyle = `rgba(245, 158, 11, ${intensity})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 1);
            ctx.fill();
        }

        // Bottom reference line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, h - 0.5);
        ctx.lineTo(w, h - 0.5);
        ctx.stroke();
    }, [samples]);

    return <canvas ref={canvasRef} className="h-full w-full" style={{ display: 'block' }} />;
};

// ---------------------------------------------------------------------------
// MidiCalibrationPanel
// ---------------------------------------------------------------------------

type MidiCalibrationPanelProps = {
    /** Current calibration values (read from store at view level). */
    calibration: GrandBouleMidiCalibration;
    /** Raw MIDI velocity (0..127) of the most recently received note-on. */
    lastVelocity: number | null;
    /** Individual parameter change callbacks. */
    onVelocityCurveExponentChange: (value: number) => void;
    onVelocityFloorChange: (value: number) => void;
    onVelocityCeilingChange: (value: number) => void;
    onCcSmoothingMsChange: (value: number) => void;
    onSustainThresholdChange: (value: number) => void;
    onAfterTouchSensitivityChange: (value: number) => void;
    /** Called when the user resets all calibration to defaults. */
    onReset: () => void;
    className?: string;
};

export const MidiCalibrationPanel = ({
    calibration,
    lastVelocity,
    onVelocityCurveExponentChange,
    onVelocityFloorChange,
    onVelocityCeilingChange,
    onCcSmoothingMsChange,
    onSustainThresholdChange,
    onAfterTouchSensitivityChange,
    onReset,
    className,
}: MidiCalibrationPanelProps): ReactElement => {
    // Rolling velocity sample buffer for the histogram
    const [velocitySamples, setVelocitySamples] = useState<ReadonlyArray<number>>([]);

    useEffect(() => {
        if (lastVelocity === null) {
            return;
        }
        setVelocitySamples((prev) => {
            const next = [...prev, lastVelocity];
            return next.length > HISTOGRAM_MAX_SAMPLES ? next.slice(next.length - HISTOGRAM_MAX_SAMPLES) : next;
        });
    }, [lastVelocity]);

    const midiCalibration = calibration;
    const r = MIDI_CALIBRATION_RANGES;

    const hasRecentInput = velocitySamples.length > 0;

    return (
        <div className={className}>
            <DawPluginSectionCard
                className="grand-boule-window"
                title="MIDI Calibration"
                detail="Velocity curves and controller calibration (SS3.1)."
                titleClassName="text-neutral-400/80"
            >
                {/* Velocity histogram / prompt */}
                <div className="grand-boule-window relative h-16 overflow-hidden rounded-sm p-1.5">
                    {hasRecentInput ? (
                        <VelocityHistogram samples={velocitySamples} />
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <span className="text-[9px] italic text-muted-foreground/50">Play notes to calibrate</span>
                        </div>
                    )}
                </div>

                {/* Last velocity metric */}
                <DawPluginMetricTile
                    className="grand-boule-window"
                    label="Last Velocity"
                    value={lastVelocity !== null ? `${lastVelocity}` : '--'}
                    detail={lastVelocity !== null ? `${Math.round((lastVelocity / 127) * 100)}% of range` : 'No input'}
                />

                {/* Calibration knobs — row 1: velocity shaping */}
                <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                    <Knob
                        value={midiCalibration.velocityCurveExponent}
                        onChange={onVelocityCurveExponentChange}
                        label="Curve"
                        min={r.velocityCurveExponent.min}
                        max={r.velocityCurveExponent.max}
                        step={r.velocityCurveExponent.step}
                        defaultValue={r.velocityCurveExponent.default}
                        readout={(() => {
                            if (midiCalibration.velocityCurveExponent < 0.95) {
                                return 'soft';
                            }
                            if (midiCalibration.velocityCurveExponent > 1.05) {
                                return 'hard';
                            }
                            return 'linear';
                        })()}
                    />
                    <Knob
                        value={midiCalibration.velocityFloor}
                        onChange={onVelocityFloorChange}
                        label="Floor"
                        min={r.velocityFloor.min}
                        max={r.velocityFloor.max}
                        step={r.velocityFloor.step}
                        defaultValue={r.velocityFloor.default}
                        readout={`${Math.round(midiCalibration.velocityFloor * 100)}%`}
                    />
                    <Knob
                        value={midiCalibration.velocityCeiling}
                        onChange={onVelocityCeilingChange}
                        label="Ceiling"
                        min={r.velocityCeiling.min}
                        max={r.velocityCeiling.max}
                        step={r.velocityCeiling.step}
                        defaultValue={r.velocityCeiling.default}
                        readout={`${Math.round(midiCalibration.velocityCeiling * 100)}%`}
                    />
                </div>

                {/* Calibration knobs — row 2: controller tuning */}
                <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                    <Knob
                        value={midiCalibration.ccSmoothingMs}
                        onChange={onCcSmoothingMsChange}
                        label="CC Smooth"
                        min={r.ccSmoothingMs.min}
                        max={r.ccSmoothingMs.max}
                        step={r.ccSmoothingMs.step}
                        defaultValue={r.ccSmoothingMs.default}
                        readout={`${Math.round(midiCalibration.ccSmoothingMs)} ms`}
                    />
                    <Knob
                        value={midiCalibration.sustainThreshold}
                        onChange={onSustainThresholdChange}
                        label="Sus Thresh"
                        min={r.sustainThreshold.min}
                        max={r.sustainThreshold.max}
                        step={r.sustainThreshold.step}
                        defaultValue={r.sustainThreshold.default}
                        readout={`${Math.round(midiCalibration.sustainThreshold * 100)}%`}
                    />
                    <Knob
                        value={midiCalibration.afterTouchSensitivity}
                        onChange={onAfterTouchSensitivityChange}
                        label="Aftertouch"
                        min={r.afterTouchSensitivity.min}
                        max={r.afterTouchSensitivity.max}
                        step={r.afterTouchSensitivity.step}
                        defaultValue={r.afterTouchSensitivity.default}
                        readout={`${midiCalibration.afterTouchSensitivity.toFixed(1)}x`}
                    />
                </div>

                {/* Reset defaults */}
                <div className="flex items-center gap-2 pt-1">
                    <DawPluginChip
                        tone="neutral"
                        size="sm"
                        onClick={() => {
                            onReset();
                            setVelocitySamples([]);
                        }}
                    >
                        <RotateCcw className="size-3" />
                        Reset Defaults
                    </DawPluginChip>
                </div>
            </DawPluginSectionCard>
        </div>
    );
};

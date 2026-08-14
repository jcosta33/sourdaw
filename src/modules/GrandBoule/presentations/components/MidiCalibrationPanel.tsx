/**
 * MIDI Controller Calibration Panel for Grand Boule (spec SS3.1).
 *
 * Provides rotary knobs for all five calibration parameters, a real-time
 * velocity histogram rendered on a canvas, a "last velocity" metric tile,
 * and a reset-defaults chip button. Uses the amber accent palette to
 * match the Grand Boule faceplate theme.
 *
 * There is deliberately no aftertouch control. No acoustic-piano engine in
 * the premium tier maps channel pressure to tone, and the ones that expose
 * aftertouch at all expose it as an assignable modulation source with a
 * response curve, bound to nothing by default — never as a fixed sensitivity
 * multiplier into a response the engine does not have.
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

/**
 * Read-only view over the velocity ring buffer. Exposes only what the
 * histogram needs (count + in-order iteration), so the histogram never sees
 * the underlying fixed-size storage or the ring head. A fresh view object is
 * produced on each push so React/effects see a changed reference, while the
 * backing `Float64Array` is allocated once and never grows.
 */
type VelocitySampleView = {
    readonly length: number;
    /** Sample at logical index `i` (0 = oldest retained). */
    at(i: number): number;
};

/** Empty view used as the initial render state before any input arrives. */
const EMPTY_VELOCITY_VIEW: VelocitySampleView = {
    length: 0,
    at: () => 0,
};

/** Fixed-size velocity ring buffer — O(1) push, zero per-sample allocation. */
class VelocityRing {
    private readonly buffer = new Float64Array(HISTOGRAM_MAX_SAMPLES);
    private start = 0;
    private count = 0;

    push(value: number): void {
        const end = (this.start + this.count) % HISTOGRAM_MAX_SAMPLES;
        this.buffer[end] = value;
        if (this.count < HISTOGRAM_MAX_SAMPLES) {
            this.count += 1;
        } else {
            // Buffer full: overwrite oldest by advancing the start cursor.
            this.start = (this.start + 1) % HISTOGRAM_MAX_SAMPLES;
        }
    }

    clear(): void {
        this.start = 0;
        this.count = 0;
    }

    /** Snapshot a stable, in-order read-only view of the current contents. */
    view(): VelocitySampleView {
        const buffer = this.buffer;
        const start = this.start;
        const count = this.count;
        return {
            length: count,
            at(i: number): number {
                return buffer[(start + i) % HISTOGRAM_MAX_SAMPLES]!;
            },
        };
    }
}

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
    hint,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
    /** Optional explanatory copy surfaced on hover, for knobs with a
     *  behaviour a player would otherwise only discover by ear. */
    hint?: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1" title={hint}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            aria-label={label}
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

const VelocityHistogram = ({ samples }: { samples: VelocitySampleView }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // Backing-store size in device pixels. Kept in a ref so the data-draw
    // effect can read the current CSS size without re-measuring the layout
    // (getBoundingClientRect) on every note-on.
    const cssSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

    // Resize / DPR-scale effect: runs only when the element actually resizes,
    // not on every sample. Splitting this off keeps getBoundingClientRect,
    // canvas.width assignment (which clears the canvas), and ctx.scale out of
    // the hot per-sample draw path.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return undefined;
        }
        const applySize = (): void => {
            const dpr = window.devicePixelRatio;
            const rect = canvas.getBoundingClientRect();
            cssSizeRef.current = { w: rect.width, h: rect.height };
            const wDev = Math.round(rect.width * dpr);
            const hDev = Math.round(rect.height * dpr);
            if (canvas.width !== wDev) {
                canvas.width = wDev;
            }
            if (canvas.height !== hDev) {
                canvas.height = hDev;
            }
            const ctx = canvas.getContext('2d');
            if (ctx !== null) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        };
        applySize();
        const observer = new ResizeObserver(() => applySize());
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    // Data-draw effect: redraws bars only, reusing the cached CSS size. No
    // layout measurement and no backing-store resize here.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            return;
        }

        const { w, h } = cssSizeRef.current;

        // Bucket velocities into bins (0..127 -> 0..HISTOGRAM_BINS-1)
        const bins = new Uint32Array(HISTOGRAM_BINS);
        for (let s = 0; s < samples.length; s += 1) {
            const v = samples.at(s);
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

    return (
        <canvas
            ref={canvasRef}
            className="h-full w-full"
            style={{ display: 'block' }}
            role="img"
            aria-label={`Velocity histogram of the last ${samples.length} note${samples.length === 1 ? '' : 's'}`}
        />
    );
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
    onReset,
    className,
}: MidiCalibrationPanelProps): ReactElement => {
    // Rolling velocity samples backed by a fixed-size ring buffer. The ring
    // is mutated in place (no per-note array spread/slice); a snapshot view is
    // published to state so the histogram redraws.
    const ringRef = useRef<VelocityRing>(new VelocityRing());
    const [samplesView, setSamplesView] = useState<VelocitySampleView>(EMPTY_VELOCITY_VIEW);

    useEffect(() => {
        if (lastVelocity === null) {
            return;
        }
        ringRef.current.push(lastVelocity);
        setSamplesView(ringRef.current.view());
    }, [lastVelocity]);

    const midiCalibration = calibration;
    const r = MIDI_CALIBRATION_RANGES;

    const hasRecentInput = samplesView.length > 0;

    let velocityCurveReadout = 'linear';
    if (midiCalibration.velocityCurveExponent < 0.95) {
        velocityCurveReadout = 'soft';
    } else if (midiCalibration.velocityCurveExponent > 1.05) {
        velocityCurveReadout = 'hard';
    }

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
                        <VelocityHistogram samples={samplesView} />
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
                        label="Velocity Curve"
                        min={r.velocityCurveExponent.min}
                        max={r.velocityCurveExponent.max}
                        step={r.velocityCurveExponent.step}
                        defaultValue={r.velocityCurveExponent.default}
                        readout={velocityCurveReadout}
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

                {/* Calibration knobs — row 2: controller tuning. Two knobs in a
                    three-column grid on purpose, so they stay aligned under row
                    one rather than stretching to fill the row. */}
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
                        hint={
                            'Smooths stepped sustain-pedal CC into a continuous damper movement. ' +
                            'The damper curve lags the pedal by roughly this long, so a note released ' +
                            'during a fast stomp sustains immediately but stays damped for a moment ' +
                            '(up to ~250 ms at 50). Turn it down if stomped pedals sound soft.'
                        }
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
                        hint={
                            'Pedal position at which the dampers start to leave the strings, for ' +
                            'pedals whose travel or rest position differs from the reference. Not ' +
                            'the on/off point at which the pedal starts catching note-offs — that ' +
                            'stays at the MIDI-standard halfway mark.'
                        }
                    />
                </div>

                {/* Reset defaults */}
                <div className="flex items-center gap-2 pt-1">
                    <DawPluginChip
                        tone="neutral"
                        size="sm"
                        onClick={() => {
                            onReset();
                            ringRef.current.clear();
                            setSamplesView(ringRef.current.view());
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

/**
 * SpectrumAnalyzer — real-time frequency spectrum display.
 *
 * Canvas-based spectrum analyzer with spectral heatmap overlay.
 * Designed to integrate with the crossover display and show
 * per-band energy concentration.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { freqToLogX } from '#/components/daw/spectrumMath';

type SpectrumAnalyzerProps = {
    width: number;
    height: number;
    /** FFT magnitude data (linear, 0-1 range) */
    fftData?: Float32Array;
    /** Band boundaries for overlay */
    crossoverFreqs?: number[];
    bandCount?: number;
    activeBand?: number;
    /** Show spectral heatmap trail */
    showHeatmap?: boolean;
};

const NUM_BARS = 128;
const HEATMAP_TRAIL = 120;

// Hoisted scratch buffer — shared across all SpectrumAnalyzer instances, safe
// because `draw()` is synchronous and only one instance paints at a time on
// the main thread. Avoids `new Array(NUM_BARS).fill(0)` per render (§150.3).
const _barDataScratch = new Float32Array(NUM_BARS);

type HeatmapRing = { rows: Float32Array[]; head: number; count: number };

export const SpectrumAnalyzer = ({
    width,
    height,
    fftData,
    crossoverFreqs = [],
    bandCount = 1,
    activeBand: _activeBand = 0,
    showHeatmap = false,
}: SpectrumAnalyzerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Ring buffer of barData snapshots, indexed by (head - row) mod
    // HEATMAP_TRAIL. `head` points to the most recent slot; `count` is the
    // number of valid rows. Replaces `Array#shift()` (§150.3).
    const heatmapRef = useRef<HeatmapRing>({ rows: [], head: 0, count: 0 });

    // No FFT telemetry source is wired for Bacteria yet (BacteriaNode emits
    // only meter/level telemetry, not spectrum bins). When `fftData` is
    // absent we render an honest idle state instead of fabricating
    // `Math.random()` noise that read as a live spectrum.
    const hasSpectrum = Boolean(fftData && fftData.length > 0);

    const drawIdle = (ctx: CanvasRenderingContext2D): void => {
        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, width, height);

        // Frequency grid (kept so the analyzer still reads as a frequency view)
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (const freq of [100, 1000, 10000]) {
            const x = freqToLogX(freq, width);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let db = -60; db <= 0; db += 12) {
            const y = height * (1 - (db + 60) / 60);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Crossover lines stay visible — they reflect real patch state.
        for (let i = 0; i < Math.min(bandCount - 1, crossoverFreqs.length); i++) {
            const x = freqToLogX(crossoverFreqs[i]!, width);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Idle label
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No spectrum signal', width / 2, height / 2);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    };

    const draw = (): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        if (!hasSpectrum) {
            drawIdle(ctx);
            return;
        }

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, width, height);

        // Frequency grid
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (const freq of [100, 1000, 10000]) {
            const x = freqToLogX(freq, width);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // dB grid
        for (let db = -60; db <= 0; db += 12) {
            const y = height * (1 - (db + 60) / 60);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        const heatmap = heatmapRef.current;

        // Draw heatmap trail — walk the ring buffer backwards from head.
        if (showHeatmap && heatmap.count > 0) {
            const maxTrail = 60;
            const rows = heatmap.rows;
            const trail = Math.min(heatmap.count, maxTrail);
            const barWidth = width / NUM_BARS;
            for (let row = 0; row < trail; row++) {
                const idx = (heatmap.head - row + HEATMAP_TRAIL) % HEATMAP_TRAIL;
                const data = rows[idx];
                if (!data) {
                    continue;
                }
                const alpha = 0.02 * (1 - row / maxTrail);
                for (let i = 0; i < NUM_BARS; i++) {
                    const val = data[i]!;
                    if (val < 0.01) {
                        continue;
                    }
                    const x = (i / NUM_BARS) * width;
                    ctx.fillStyle = `rgba(244, 63, 94, ${alpha * val})`;
                    ctx.fillRect(x, height - row, barWidth, 1);
                }
            }
        }

        // Generate display data into the hoisted scratch buffer (§150.3).
        // `hasSpectrum` is true here (the idle path returned early above), so
        // `fftData` is guaranteed non-empty.
        const barData = _barDataScratch;
        const bins = fftData!;
        const binPerBar = bins.length / NUM_BARS;
        for (let i = 0; i < NUM_BARS; i++) {
            let sum = 0;
            const start = Math.floor(i * binPerBar);
            const end = Math.floor((i + 1) * binPerBar);
            for (let j = start; j < end && j < bins.length; j++) {
                sum += bins[j]!;
            }
            barData[i] = sum / Math.max(1, end - start);
        }

        // Store for heatmap — O(1) ring buffer write, no shift or spread copy.
        if (showHeatmap) {
            const rows = heatmap.rows;
            const nextHead = heatmap.count === 0 ? 0 : (heatmap.head + 1) % HEATMAP_TRAIL;
            let slot = rows[nextHead];
            if (!slot) {
                slot = new Float32Array(NUM_BARS);
                rows[nextHead] = slot;
            }
            slot.set(barData);
            heatmap.head = nextHead;
            if (heatmap.count < HEATMAP_TRAIL) {
                heatmap.count++;
            }
        }

        // Draw spectrum bars — single solid fill replaces the 128 per-bar
        // `createLinearGradient` allocations (§150.1). Visually indistinguishable
        // at bar widths < 3px.
        ctx.fillStyle = 'rgba(244, 63, 94, 0.4)';
        const barWidth = width / NUM_BARS;
        for (let i = 0; i < NUM_BARS; i++) {
            const val = barData[i]!;
            const barHeight = val * height * 0.9;
            const x = i * barWidth;
            ctx.fillRect(x, height - barHeight, barWidth - 0.5, barHeight);
        }

        // Draw spectrum line
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < NUM_BARS; i++) {
            const x = (i + 0.5) * barWidth;
            const y = height - barData[i]! * height * 0.9;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Crossover lines
        for (let i = 0; i < Math.min(bandCount - 1, crossoverFreqs.length); i++) {
            const x = freqToLogX(crossoverFreqs[i]!, width);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    };

    useEffect(() => {
        draw();
        // Dep array narrowed from "run every render" to "run when inputs that
        // actually affect the draw change" (§150.2).
    }, [fftData, width, height, crossoverFreqs, bandCount, showHeatmap]);

    return <canvas ref={canvasRef} width={width} height={height} className="rounded-lg border border-border/30" />;
};

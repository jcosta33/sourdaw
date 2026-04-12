/**
 * Spectrum Analyzer component.
 * Real-time FFT-based frequency display using Canvas2D.
 * Inspired by FabFilter Pro-Q style: perceptual tilt, logarithmic frequency axis.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterAnalyser, getTrackAnalyser, getAudioSampleRate } from '#/modules/AudioEngine/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';

type SpectrumAnalyzerProps = {
    trackId?: string;
    width?: number;
    height?: number;
    color?: string;
};

export const SpectrumAnalyzer = ({
    trackId,
    width = 300,
    height = 120,
    color = resolveToken('--color-palette-steel', '#4a7090'),
}: SpectrumAnalyzerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        let rafId = 0;

        const draw = (): void => {
            const analyser = trackId ? (getTrackAnalyser(trackId) ?? getMasterAnalyser()) : getMasterAnalyser();

            const fftSize = analyser.frequencyBinCount;
            const freqData = new Float32Array(fftSize);
            analyser.getFloatFrequencyData(freqData);

            const sampleRate = getAudioSampleRate();

            ctx.clearRect(0, 0, width, height);

            // Background — deep black with subtle noise texture
            ctx.fillStyle = '#050508';
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 4);
            ctx.fill();
            // Subtle noise overlay
            ctx.globalAlpha = 0.03;
            for (let nx = 0; nx < width; nx += 3) {
                for (let ny = 0; ny < height; ny += 3) {
                    const v = Math.random() * 255;
                    ctx.fillStyle = `rgb(${v},${v},${v})`;
                    ctx.fillRect(nx, ny, 2, 2);
                }
            }
            ctx.globalAlpha = 1;

            // Grid lines (frequency) — subtle dashed
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 4]);
            const freqMarks = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
            for (const f of freqMarks) {
                const x = freqToX(f, width, sampleRate);
                if (x > 0 && x < width) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    ctx.stroke();
                }
            }

            // Grid lines (dB) — subtle dashed
            const dbMarks = [-60, -48, -36, -24, -12, 0];
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '7px monospace';
            for (const db of dbMarks) {
                const y = dbToY(db, height);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillText(`${db}`, 2, y - 2);
            }
            ctx.setLineDash([]);

            // Frequency labels — dim and refined
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.textAlign = 'center';
            for (const f of [100, 1000, 10000]) {
                const x = freqToX(f, width, sampleRate);
                const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
                ctx.fillText(label, x, height - 2);
            }
            ctx.textAlign = 'left';

            // Draw spectrum with blue→cyan→green→yellow→red gradient fill
            const grad = ctx.createLinearGradient(0, height, 0, 0);
            grad.addColorStop(0, 'rgba(0,80,220,0.05)');
            grad.addColorStop(0.3, 'rgba(0,180,220,0.15)');
            grad.addColorStop(0.5, 'rgba(0,210,120,0.25)');
            grad.addColorStop(0.7, 'rgba(200,200,0,0.35)');
            grad.addColorStop(1, 'rgba(255,50,0,0.45)');

            ctx.beginPath();
            ctx.moveTo(0, height);

            for (let i = 1; i < fftSize; i++) {
                const freq = (i / fftSize) * (sampleRate / 2);
                if (freq < 20 || freq > 22000) {
                    continue;
                }

                const x = freqToX(freq, width, sampleRate);
                const db = Math.max(-80, freqData[i]!);
                // Perceptual tilt: +3dB/octave above 1kHz
                const tiltedDb = db + 3 * Math.log2(Math.max(1, freq / 1000));
                const y = dbToY(tiltedDb, height);

                if (i === 1) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Spectrum line — glow pass (wider, semi-transparent)
            ctx.beginPath();
            for (let i = 1; i < fftSize; i++) {
                const freq = (i / fftSize) * (sampleRate / 2);
                if (freq < 20 || freq > 22000) {
                    continue;
                }

                const x = freqToX(freq, width, sampleRate);
                const db = Math.max(-80, freqData[i]!);
                const tiltedDb = db + 3 * Math.log2(Math.max(1, freq / 1000));
                const y = dbToY(tiltedDb, height);

                if (i === 1) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = `${color}30`;
            ctx.lineWidth = 5;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Spectrum line — sharp pass
            ctx.beginPath();
            for (let i = 1; i < fftSize; i++) {
                const freq = (i / fftSize) * (sampleRate / 2);
                if (freq < 20 || freq > 22000) {
                    continue;
                }

                const x = freqToX(freq, width, sampleRate);
                const db = Math.max(-80, freqData[i]!);
                const tiltedDb = db + 3 * Math.log2(Math.max(1, freq / 1000));
                const y = dbToY(tiltedDb, height);

                if (i === 1) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, width, height, color]);

    return (
        <DawMeterFrame>
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="block"
                aria-label="Spectrum analyzer"
                role="img"
            />
        </DawMeterFrame>
    );
};

// Logarithmic frequency to X position
function freqToX(freq: number, width: number, sampleRate: number): number {
    const minFreq = 20;
    const maxFreq = Math.min(22000, sampleRate / 2);
    return (Math.log10(freq / minFreq) / Math.log10(maxFreq / minFreq)) * width;
}

// dB to Y position (-80 to 0 dB range)
function dbToY(db: number, height: number): number {
    const minDb = -80;
    const maxDb = 6;
    return height - ((db - minDb) / (maxDb - minDb)) * height;
}

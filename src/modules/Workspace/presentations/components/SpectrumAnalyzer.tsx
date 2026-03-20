/**
 * Spectrum Analyzer component.
 * Real-time FFT-based frequency display using Canvas2D.
 * Inspired by FabFilter Pro-Q style: perceptual tilt, logarithmic frequency axis.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';

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
    color = '#3b82f6',
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
            const analyser = trackId
                ? (audioEngine.getTrackStrip(trackId)?.analyserNode ?? audioEngine.masterAnalyser)
                : audioEngine.masterAnalyser;

            const fftSize = analyser.frequencyBinCount;
            const freqData = new Float32Array(fftSize);
            analyser.getFloatFrequencyData(freqData);

            const sampleRate = audioEngine.context?.sampleRate ?? 44100;

            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 4);
            ctx.fill();

            // Grid lines (frequency)
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 0.5;
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

            // Grid lines (dB)
            const dbMarks = [-60, -48, -36, -24, -12, 0];
            ctx.fillStyle = '#333';
            ctx.font = '7px monospace';
            for (const db of dbMarks) {
                const y = dbToY(db, height);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillText(`${db}`, 2, y - 2);
            }

            // Frequency labels
            ctx.fillStyle = '#444';
            ctx.textAlign = 'center';
            for (const f of [100, 1000, 10000]) {
                const x = freqToX(f, width, sampleRate);
                const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
                ctx.fillText(label, x, height - 2);
            }
            ctx.textAlign = 'left';

            // Draw spectrum with gradient fill
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, color);
            grad.addColorStop(1, `${color}10`);

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

            // Spectrum line
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
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label="Spectrum analyzer"
            role="img"
        />
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

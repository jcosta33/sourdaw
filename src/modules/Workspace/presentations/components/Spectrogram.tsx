/**
 * Spectrogram (Waterfall) component.
 * Time×frequency heat map using Canvas2D.
 * Scrolls horizontally over time, displaying FFT magnitude as
 * color intensity from dark blue → cyan → yellow → white.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';

type SpectrogramProps = {
    trackId?: string;
    width?: number;
    height?: number;
};

export const Spectrogram = ({
    trackId,
    width = 300,
    height = 100,
}: SpectrogramProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const columnRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        // Pre-build color LUT (256 entries)
        const colorLUT: string[] = [];
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let r: number, g: number, b: number;
            if (t < 0.25) {
                // Dark blue → blue
                const s = t / 0.25;
                r = 0;
                g = 0;
                b = Math.round(40 + s * 180);
            } else if (t < 0.5) {
                // Blue → cyan
                const s = (t - 0.25) / 0.25;
                r = 0;
                g = Math.round(s * 220);
                b = 220;
            } else if (t < 0.75) {
                // Cyan → yellow
                const s = (t - 0.5) / 0.25;
                r = Math.round(s * 255);
                g = 220;
                b = Math.round(220 * (1 - s));
            } else {
                // Yellow → white
                const s = (t - 0.75) / 0.25;
                r = 255;
                g = Math.round(220 + s * 35);
                b = Math.round(s * 255);
            }
            colorLUT.push(`rgb(${r},${g},${b})`);
        }

        let rafId = 0;
        columnRef.current = 0;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        const draw = (): void => {
            const analyser = trackId
                ? audioEngine.getTrackStrip(trackId)?.analyserNode ?? audioEngine.masterAnalyser
                : audioEngine.masterAnalyser;

            const fftSize = analyser.frequencyBinCount;
            const freqData = new Float32Array(fftSize);
            analyser.getFloatFrequencyData(freqData);

            const col = columnRef.current % width;

            // Draw one column of pixels
            const binsPerPixel = Math.ceil(fftSize / height);
            for (let y = 0; y < height; y++) {
                // Map y (0=top=high freq) to frequency bin
                const binIndex = Math.floor(((height - 1 - y) / height) * fftSize);
                let maxDb = -100;
                for (let b = binIndex; b < Math.min(binIndex + binsPerPixel, fftSize); b++) {
                    if (freqData[b]! > maxDb) {
                        maxDb = freqData[b]!;
                    }
                }

                // Normalize dB to 0-255
                const normalized = Math.max(0, Math.min(255, Math.round(((maxDb + 90) / 90) * 255)));
                ctx.fillStyle = colorLUT[normalized]!;
                ctx.fillRect(col, y, 1, 1);
            }

            // Draw cursor line
            const nextCol = (col + 1) % width;
            ctx.fillStyle = '#fff';
            ctx.fillRect(nextCol, 0, 1, height);

            columnRef.current++;
            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label="Spectrogram"
            role="img"
        />
    );
};

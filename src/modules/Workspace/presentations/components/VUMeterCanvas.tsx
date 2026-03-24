/**
 * VU Meter component with 300ms ballistics and peak hold.
 * Canvas2D rendering with green/amber/red arc.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { getMasterAnalyser, getTrackStripAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';
import { resolveToken } from '#/helpers/UI/resolveToken';
import { VUMeter as VUMeterProcessor } from '#/modules/AudioEngine/useCases/advancedMetering';

type VUMeterCanvasProps = {
    trackId?: string;
    size?: number;
};

const linearToDb = (linear: number): number => {
    if (linear <= 0) {
        return -60;
    }
    return Math.max(-60, 20 * Math.log10(linear));
};

export const VUMeterCanvas = ({ trackId, size = 100 }: VUMeterCanvasProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const vuRef = useRef(new VUMeterProcessor());
    const lastTimeRef = useRef(performance.now());

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
            const now = performance.now();
            const deltaTime = (now - lastTimeRef.current) / 1000;
            lastTimeRef.current = now;

            const analyser = trackId
                ? (getTrackStripAnalyser(trackId) ?? getMasterAnalyser())
                : getMasterAnalyser();

            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            vuRef.current.update(data, deltaTime);
            const level = vuRef.current.level;
            const peakHold = vuRef.current.peak;

            // Draw VU meter as vertical bar with ballistics
            ctx.clearRect(0, 0, size, size);

            const barWidth = size * 0.35;
            const barHeight = size * 0.85;
            const barX = (size - barWidth) / 2;
            const barY = size * 0.05;

            // Background
            ctx.fillStyle = resolveToken('--color-bg-panel', '#111');
            ctx.beginPath();
            ctx.roundRect(barX, barY, barWidth, barHeight, 3);
            ctx.fill();

            // Level bar
            const levelDb = linearToDb(level);
            const levelPct = Math.max(0, Math.min(1, (levelDb + 60) / 60));
            const levelH = levelPct * barHeight;

            // Gradient: green → amber → red
            const grad = ctx.createLinearGradient(0, barY + barHeight, 0, barY);
            grad.addColorStop(0, resolveToken('--color-meter-safe', '#4a9060'));
            grad.addColorStop(0.6, resolveToken('--color-meter-safe', '#4a9060'));
            grad.addColorStop(0.75, resolveToken('--color-meter-hot', '#b09040'));
            grad.addColorStop(0.9, resolveToken('--color-meter-clip', '#b05050'));
            grad.addColorStop(1, resolveToken('--color-meter-clip', '#b05050'));

            ctx.fillStyle = grad;
            ctx.fillRect(barX + 1, barY + barHeight - levelH, barWidth - 2, levelH);

            // Peak hold line
            const peakDb = linearToDb(peakHold);
            const peakPct = Math.max(0, Math.min(1, (peakDb + 60) / 60));
            const peakY = barY + barHeight - peakPct * barHeight;
            ctx.strokeStyle = peakDb > -3 ? resolveToken('--color-meter-clip', '#b05050') : resolveToken('--color-meter-hot', '#b09040');
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(barX + 1, peakY);
            ctx.lineTo(barX + barWidth - 1, peakY);
            ctx.stroke();

            // dB labels
            ctx.fillStyle = resolveToken('--color-text-tertiary', '#666');
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            const labelX = barX + barWidth + 3;
            for (const db of [0, -6, -12, -24, -48]) {
                const y = barY + barHeight - ((db + 60) / 60) * barHeight;
                ctx.fillText(`${db}`, labelX, y + 3);
                ctx.fillRect(barX, y, barWidth, 0.5);
            }

            // Current dB readout
            ctx.fillStyle = levelDb > -3 ? resolveToken('--color-meter-clip', '#b05050') : resolveToken('--color-palette-gray', '#888');
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(levelDb > -60 ? `${levelDb.toFixed(1)}` : '-∞', size / 2, size - 1);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, size]);

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="rounded border border-border/30"
            aria-label="VU meter"
        />
    );
};

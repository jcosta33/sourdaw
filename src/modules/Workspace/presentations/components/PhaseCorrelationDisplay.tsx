/**
 * Phase Correlation Meter component.
 * Displays mono compatibility as a horizontal bar from -1 to +1.
 * Canvas2D rendering with smoothed correlation value.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { getMasterAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';
import { PhaseCorrelationMeter as PhaseMeter } from '#/modules/AudioEngine/useCases/advancedMetering';
import { resolveToken } from '#/helpers/UI/resolveToken';

type PhaseCorrelationDisplayProps = {
    width?: number;
    height?: number;
};

export const PhaseCorrelationDisplay = ({ width = 160, height = 24 }: PhaseCorrelationDisplayProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const meterRef = useRef(new PhaseMeter());

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
            const analyser = getMasterAnalyser();
            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            // Split into pseudo L/R (AnalyserNode is mono sum — for true stereo,
            // the engine would need a ChannelSplitter. Here we approximate by
            // treating odd/even samples as L/R, which works for interleaved sources)
            const halfLen = Math.floor(data.length / 2);
            const left = new Float32Array(halfLen);
            const right = new Float32Array(halfLen);
            for (let i = 0; i < halfLen; i++) {
                left[i] = data[i * 2]!;
                right[i] = data[i * 2 + 1]!;
            }

            const correlation = meterRef.current.update(left, right);

            // Draw
            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = resolveToken('--color-bg-panel', '#111');
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 3);
            ctx.fill();

            // Scale: -1 (left) to +1 (right)
            const midX = width / 2;
            const barY = 4;
            const barH = height - 8;

            // Background bar
            ctx.fillStyle = resolveToken('--color-bg-dialog', '#222');
            ctx.fillRect(2, barY, width - 4, barH);

            // Center line
            ctx.strokeStyle = resolveToken('--color-text-disabled', '#3a3a3a');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(midX, barY);
            ctx.lineTo(midX, barY + barH);
            ctx.stroke();

            // Correlation indicator
            const indicatorX = midX + correlation * (midX - 4);
            const color =
                correlation > 0.5
                    ? resolveToken('--color-meter-safe', '#4a9060') // Good mono compatibility
                    : correlation > 0
                      ? resolveToken('--color-meter-hot', '#b09040') // Moderate
                      : resolveToken('--color-meter-clip', '#b05050'); // Phase issues

            // Bar from center to correlation value
            const barStart = Math.min(midX, indicatorX);
            const barW = Math.abs(indicatorX - midX);
            ctx.fillStyle = `${color}99`;
            ctx.fillRect(barStart, barY + 1, barW, barH - 2);

            // Indicator dot
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(indicatorX, barY + barH / 2, 4, 0, Math.PI * 2);
            ctx.fill();

            // Labels
            ctx.fillStyle = resolveToken('--color-text-tertiary', '#666');
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            ctx.fillText('-1', 4, height - 2);
            ctx.textAlign = 'center';
            ctx.fillText('0', midX, height - 2);
            ctx.textAlign = 'right';
            ctx.fillText('+1', width - 4, height - 2);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label="Phase correlation meter"
            role="meter"
            aria-valuemin={-1}
            aria-valuemax={1}
        />
    );
};

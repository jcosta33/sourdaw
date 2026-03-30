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

            // Background — deep black
            ctx.fillStyle = '#080808';
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 3);
            ctx.fill();

            // Scale: -1 (left) to +1 (right)
            const midX = width / 2;
            const barY = 4;
            const barH = height - 8;

            // Background bar — slightly lighter
            ctx.fillStyle = '#101014';
            ctx.fillRect(2, barY, width - 4, barH);

            // Center line — subtle dashed
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(midX, barY);
            ctx.lineTo(midX, barY + barH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Correlation indicator
            const indicatorX = midX + correlation * (midX - 4);
            const color =
                correlation > 0.5
                    ? resolveToken('--color-meter-safe', '#00CC44') // Good mono compatibility
                    : correlation > 0
                      ? resolveToken('--color-meter-hot', '#CCCC00') // Moderate
                      : resolveToken('--color-meter-clip', '#FF3300'); // Phase issues

            // Bar from center to correlation value — with glow
            const barStart = Math.min(midX, indicatorX);
            const barW = Math.abs(indicatorX - midX);
            ctx.fillStyle = `${color}66`;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            ctx.fillRect(barStart, barY + 1, barW, barH - 2);
            ctx.shadowBlur = 0;

            // Indicator dot — bright with glow
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(indicatorX, barY + barH / 2, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Labels — dim and refined
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
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
        <div className="relative rounded bg-[#0a0a0a] channel-inset overflow-hidden">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="block"
                aria-label="Phase correlation meter"
                role="meter"
                aria-valuemin={-1}
                aria-valuemax={1}
            />
            <div
                className="absolute inset-0 pointer-events-none rounded"
                style={{
                    background:
                        'linear-gradient(90deg, rgba(10,10,10,1) 0%, transparent 4%, transparent 96%, rgba(10,10,10,1) 100%)',
                }}
            />
        </div>
    );
};

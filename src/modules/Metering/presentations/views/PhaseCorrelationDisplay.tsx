/**
 * Phase Correlation Meter component.
 * Displays mono compatibility as a horizontal bar from -1 to +1.
 * Canvas2D rendering with smoothed correlation value.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterStereoAnalysers, PhaseCorrelationMeter as PhaseMeter } from '#/modules/AudioEngine/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';

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
            return undefined;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        let rafId = 0;
        // Reused across frames — reallocated only if fftSize changes.
        let left: Float32Array<ArrayBuffer> | null = null;
        let right: Float32Array<ArrayBuffer> | null = null;

        // §194.1 — resolve CSS tokens once per mount rather than on every
        // rAF tick. Each resolveToken() call invokes getComputedStyle on
        // the document root, which triggers a style-read and is expensive
        // to run at 60 Hz. Tokens don't change mid-animation.
        const safeColor = resolveToken('--color-meter-safe', '#00CC44');
        const hotColor = resolveToken('--color-meter-hot', '#CCCC00');
        const clipColor = resolveToken('--color-meter-clip', '#FF3300');

        const draw = (): void => {
            const { left: leftAnalyser, right: rightAnalyser } = getMasterStereoAnalysers();
            if (!left || left.length !== leftAnalyser.fftSize) {
                left = new Float32Array(leftAnalyser.fftSize);
            }
            if (!right || right.length !== rightAnalyser.fftSize) {
                right = new Float32Array(rightAnalyser.fftSize);
            }
            leftAnalyser.getFloatTimeDomainData(left);
            rightAnalyser.getFloatTimeDomainData(right);

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
            let color: string;
            if (correlation > 0.5) {
                color = safeColor; // Good mono compatibility
            } else if (correlation > 0) {
                color = hotColor; // Moderate
            } else {
                color = clipColor; // Phase issues
            }

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
        <DawMeterFrame>
            <div
                role="meter"
                aria-label="Phase correlation meter"
                aria-valuemin={-1}
                aria-valuemax={1}
                aria-valuenow={0}
            >
                <canvas ref={canvasRef} width={width} height={height} className="block" aria-hidden="true" />
            </div>
        </DawMeterFrame>
    );
};

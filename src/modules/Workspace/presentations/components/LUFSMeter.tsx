/**
 * LUFS Meter component.
 * Displays momentary, short-term, and integrated loudness on a Canvas2D bar.
 */
import { type ReactElement, useRef, useEffect, useState } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';
import { resolveToken } from '#/helpers/UI/resolveToken';
import { computeMomentaryLUFS, ShortTermLUFS, IntegratedLUFS } from '#/modules/AudioEngine/useCases/advancedMetering';

type LUFSMeterProps = {
    height?: number;
    width?: number;
    target?: number;
};

export const LUFSMeter = ({ height = 160, width = 48, target = -14 }: LUFSMeterProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const shortTermRef = useRef(new ShortTermLUFS());
    const integratedRef = useRef(new IntegratedLUFS());
    const [momentary, setMomentary] = useState(-70);
    const [shortTerm, setShortTerm] = useState(-70);
    const [integrated, setIntegrated] = useState(-70);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        // HiDPI scaling
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Resolve theme tokens once, outside the animation loop
        const bgColor = resolveToken('--color-bg-tray', '#0a0a0a');
        const textDisabled = resolveToken('--color-text-disabled', '#3a3a3a');
        const paletteSky = resolveToken('--color-palette-sky', '#5a80a8');
        const meterClip = resolveToken('--color-meter-clip', '#b05050');
        const meterHot = resolveToken('--color-meter-hot', '#b09040');
        const meterSafe = resolveToken('--color-meter-safe', '#4a9060');
        const paletteGray = resolveToken('--color-palette-gray', '#888');

        let rafId = 0;
        let lastStateUpdate = 0;
        const STATE_UPDATE_INTERVAL = 100; // ~10fps for React state

        const draw = (): void => {
            const analyser = audioEngine.masterAnalyser;
            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            const mom = computeMomentaryLUFS(data, audioEngine.context.sampleRate);
            shortTermRef.current.push(mom);
            integratedRef.current.push(mom);

            const st = shortTermRef.current.value;
            const integ = integratedRef.current.value;

            // Throttle React state updates to ~10fps (only for text/aria readout)
            const now = performance.now();
            if (now - lastStateUpdate > STATE_UPDATE_INTERVAL) {
                setMomentary(mom);
                setShortTerm(st);
                setIntegrated(integ);
                lastStateUpdate = now;
            }

            // Draw
            ctx.clearRect(0, 0, width, height);

            const minLUFS = -60;
            const maxLUFS = 0;
            const range = maxLUFS - minLUFS;
            const lufsToY = (lufs: number): number =>
                height - ((Math.max(minLUFS, Math.min(maxLUFS, lufs)) - minLUFS) / range) * height;

            // Background
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, width, height);

            // Scale marks
            ctx.fillStyle = textDisabled;
            ctx.font = '8px monospace';
            ctx.textAlign = 'right';
            for (let db = 0; db >= minLUFS; db -= 6) {
                const y = lufsToY(db);
                ctx.fillRect(0, y, width, 0.5);
                ctx.fillText(`${db}`, width - 2, y - 2);
            }

            // Target line
            const targetY = lufsToY(target);
            ctx.strokeStyle = paletteSky;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(0, targetY);
            ctx.lineTo(width, targetY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Momentary bar
            const barW = 10;
            const momY = lufsToY(mom);
            ctx.fillStyle = mom > -3 ? meterClip : mom > -14 ? meterHot : meterSafe;
            ctx.fillRect(2, momY, barW, height - momY);

            // Short-term bar
            const stY = lufsToY(st);
            ctx.fillStyle = st > -3 ? `${meterClip}99` : st > -14 ? `${meterHot}99` : `${meterSafe}99`;
            ctx.fillRect(14, stY, barW, height - stY);

            // Integrated bar
            const integY = lufsToY(integ);
            ctx.fillStyle = paletteSky;
            ctx.fillRect(26, integY, barW, height - integY);

            // Labels
            ctx.fillStyle = paletteGray;
            ctx.font = '7px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('M', 7, height - 2);
            ctx.fillText('S', 19, height - 2);
            ctx.fillText('I', 31, height - 2);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [height, width, target]);

    return (
        <div className="flex flex-col items-center gap-1">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="rounded border border-border/30"
                aria-label={`LUFS: Momentary ${momentary > -70 ? momentary.toFixed(1) : '-∞'}, Short-term ${shortTerm > -70 ? shortTerm.toFixed(1) : '-∞'}, Integrated ${integrated > -70 ? integrated.toFixed(1) : '-∞'}`}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums">
                {integrated > -70 ? integrated.toFixed(1) : '-∞'} LUFS
            </span>
        </div>
    );
};

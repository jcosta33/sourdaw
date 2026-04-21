import { type ReactElement, useEffect, useRef } from 'react';

import { getMasterAnalyser } from '#/modules/AudioEngine/useCases';
import { cn } from '#/utils/Styles/cn';

import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../hooks/useTracks';

export const MiniMasterSpectrum = ({ className }: { className?: string }): ReactElement | null => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const { tracks, selectedTrackId } = useTracks();
    const masterTrack = tracks.find((t) => t.kind === 'master');
    const isSelected = masterTrack?.id === selectedTrackId;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return undefined;
        }

        // Try getting the master analyser. Might be null if engine isn't ready.
        let analyser: AnalyserNode | undefined;
        try {
            analyser = getMasterAnalyser();
        } catch {
            return undefined;
        }

        if (!analyser) {
            return undefined;
        }

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        ctx.imageSmoothingEnabled = false;

        // §181.1 — hoist per-frame allocations outside the rAF loop.
        // The gradient only needs to be created once per effect run (it
        // depends on canvas height, which is fixed at mount), and the
        // fill style is the same for every bar so it can be set once
        // per frame instead of once per bar.
        const canvasHeight = canvas.height;
        const canvasWidth = canvas.width;
        const gradient = ctx.createLinearGradient(0, canvasHeight, 0, 0);
        gradient.addColorStop(0, 'rgba(217, 119, 6, 0.4)'); // amber/orange
        gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.8)'); // yellow
        gradient.addColorStop(1, 'rgba(252, 211, 77, 1)'); // bright
        const barFill: CanvasGradient | string = isSelected ? gradient : 'rgba(255,255,255,0.06)';
        const barWidth = Math.max(1, (canvasWidth / bufferLength) * 2.5);
        const innerBarWidth = barWidth - 0.5;

        const draw = (): void => {
            animationRef.current = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            ctx.fillStyle = barFill;

            let x = 0;
            for (let i = 0; i < bufferLength; i += 2) {
                if (x > canvasWidth) {
                    break;
                }
                const barHeight = (dataArray[i]! / 255) * canvasHeight;
                ctx.fillRect(x, canvasHeight - barHeight, innerBarWidth, barHeight);
                x += barWidth;
            }
        };

        draw();

        return () => {
            cancelAnimationFrame(animationRef.current);
        };
    }, [isSelected]);

    if (!masterTrack) {
        return null;
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => selectTrack(masterTrack.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    selectTrack(masterTrack.id);
                }
            }}
            className={cn(
                'absolute inset-0 overflow-hidden cursor-pointer transition-colors',
                isSelected ? 'bg-black/30 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)]' : 'hover:bg-white/[0.02]',
                className
            )}
            title="Master Track (Click to inspect)"
            aria-label="Master Track Spectrum"
        >
            <div className="absolute inset-x-0 bottom-0 h-full pointer-events-none opacity-40">
                <canvas ref={canvasRef} className="w-full h-full block" width={180} height={80} />
            </div>

            <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_1px,rgba(0,0,0,0.1)_1px,rgba(0,0,0,0.1)_2px)] opacity-50" />

            <div className="absolute inset-x-2 top-2 z-10 flex flex-col pointer-events-none">
                <span
                    className={cn(
                        'text-[10px] uppercase tracking-wider font-semibold drop-shadow-md transition-colors',
                        isSelected ? 'text-foreground' : 'text-muted-foreground'
                    )}
                >
                    Master
                </span>
            </div>
        </div>
    );
};

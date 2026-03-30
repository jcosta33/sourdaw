import { type ReactElement, useEffect, useRef } from 'react';
import { getMasterAnalyser } from '#/modules/AudioEngine/useCases/engineAccess';
import { useTracks } from '#/modules/Arrangement/presentations/hooks/useTracks';
import { selectTrack } from '#/modules/Arrangement/useCases/toggleTrackState/selectTrack';
import { cn } from '#/helpers/Styles/cn';

export const MiniMasterSpectrum = ({ className }: { className?: string }): ReactElement | null => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const { tracks, selectedTrackId } = useTracks();
    const masterTrack = tracks.find((t) => t.kind === 'master');
    const isSelected = masterTrack?.id === selectedTrackId;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Try getting the master analyser. Might be null if engine isn't ready.
        let analyser: AnalyserNode | undefined;
        try {
            analyser = getMasterAnalyser();
        } catch {
            return;
        }

        if (!analyser) return;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        ctx.imageSmoothingEnabled = false;

        const draw = () => {
            animationRef.current = requestAnimationFrame(draw);

            analyser!.getByteFrequencyData(dataArray);

            const width = canvas.width;
            const height = canvas.height;

            ctx.clearRect(0, 0, width, height);

            const barWidth = Math.max(1, (width / bufferLength) * 2.5);
            let x = 0;

            // Define a gradient for the spectrum
            const gradient = ctx.createLinearGradient(0, height, 0, 0);
            gradient.addColorStop(0, 'rgba(217, 119, 6, 0.4)'); // amber/orange
            gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.8)'); // yellow
            gradient.addColorStop(1, 'rgba(252, 211, 77, 1)'); // bright

            for (let i = 0; i < bufferLength; i += 2) {
                if (x > width) break;
                
                const barHeight = (dataArray[i]! / 255) * height;

                ctx.fillStyle = isSelected ? gradient : 'rgba(255,255,255,0.06)';
                ctx.fillRect(x, height - barHeight, barWidth - 0.5, barHeight);

                x += barWidth;
            }
        };

        draw();

        return () => {
            cancelAnimationFrame(animationRef.current);
        };
    }, [isSelected]);

    if (!masterTrack) return null;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => selectTrack(masterTrack.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') selectTrack(masterTrack.id);
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
                <canvas
                    ref={canvasRef}
                    className="w-full h-full block"
                    width={180}
                    height={80}
                />
            </div>
            
            <div className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_1px,rgba(0,0,0,0.1)_1px,rgba(0,0,0,0.1)_2px)] opacity-50" />
            
            <div className="absolute inset-x-2 top-2 z-10 flex flex-col pointer-events-none">
                <span 
                    className={cn(
                        "text-[10px] uppercase tracking-wider font-semibold drop-shadow-md transition-colors",
                        isSelected ? "text-foreground" : "text-muted-foreground"
                    )}
                >
                    Master
                </span>
            </div>
        </div>
    );
};

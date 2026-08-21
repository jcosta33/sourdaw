import { type ReactElement, useEffect, useId, useRef } from 'react';

import { Stack } from '#/components/layout';
import { getMasterAnalyser } from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';
import { cn } from '#/utils/Styles/cn';

import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { useTracks } from '../hooks/useTracks';

export const MiniMasterSpectrum = ({ className }: { className?: string }): ReactElement | null => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const schedulerId = useId();
    const { tracks, selectedTrackId } = useTracks();
    const masterTrack = tracks.find((time) => time.kind === 'master');
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

        // The spectrum is a decorative live readout of the master bus. It only
        // conveys anything when the master track is selected (it renders flat
        // grey otherwise), so the 60 Hz analyser read + redraw should not run
        // when unselected or when the tab is hidden — gate the loop entirely.
        if (!isSelected) {
            const dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
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

        // §181.1 — hoist per-frame allocations outside the draw loop.
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // DPR scaling — size the backing store to CSS pixels × devicePixelRatio
        // so the spectrum is crisp on 2x displays instead of being drawn at half
        // resolution (findings #26/#62). All drawing below is then in CSS pixels.
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth || canvas.width || 180;
        const cssHeight = canvas.clientHeight || canvas.height || 80;
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;

        const gradient = ctx.createLinearGradient(0, cssHeight, 0, 0);
        gradient.addColorStop(0, 'rgba(217, 119, 6, 0.4)'); // amber/orange
        gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.8)'); // yellow
        gradient.addColorStop(1, 'rgba(252, 211, 77, 1)'); // bright
        const barWidth = Math.max(1, (cssWidth / bufferLength) * 2.5);
        const innerBarWidth = barWidth - 0.5;

        const draw = (): void => {
            // Skip work entirely while the document is hidden — the analyser
            // data is invisible and rAF is already throttled, but this avoids
            // the read + fill churn on a backgrounded tab.
            if (typeof document !== 'undefined' && document.hidden) {
                return;
            }

            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, cssWidth, cssHeight);
            ctx.fillStyle = gradient;

            let x = 0;
            for (let index = 0; index < bufferLength; index += 2) {
                if (x > cssWidth) {
                    break;
                }
                const barHeight = (dataArray[index]! / 255) * cssHeight;
                ctx.fillRect(x, cssHeight - barHeight, innerBarWidth, barHeight);
                x += barWidth;
            }
        };

        // Route through the shared animation scheduler instead of a private
        // requestAnimationFrame loop so every timeline animation shares one rAF
        // (findings #40/#63/#64).
        const id = `mini-master-spectrum-${schedulerId}`;
        animationScheduler.register(id, draw);

        return () => {
            animationScheduler.unregister(id);
        };
    }, [isSelected, schedulerId]);

    if (!masterTrack) {
        return null;
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => selectTrack(masterTrack.id)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
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
            <Stack className="absolute inset-x-2 top-2 z-10 pointer-events-none">
                <span
                    className={cn(
                        'text-[10px] uppercase tracking-wider font-semibold drop-shadow-md transition-colors',
                        isSelected ? 'text-foreground' : 'text-muted-foreground'
                    )}
                >
                    Master
                </span>
            </Stack>
        </div>
    );
};

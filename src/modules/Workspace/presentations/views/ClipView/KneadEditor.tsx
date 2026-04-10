import { type ReactElement, useRef, useEffect, useLayoutEffect } from 'react';
import { kneadStore, ingestDspAnalysis, updateTrackKneadState } from '#/modules/Knead';
import { useStore } from '#/infra/store/useStore';
import { useTracks } from '../../hooks/useTracks';
import { addDevice } from '#/modules/Arrangement';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { Mic } from 'lucide-react';

export const KneadEditor = ({ trackId, clipId: _clipId }: { trackId: string; clipId: string }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { tracks } = useTracks();

    const track = tracks.find((t) => t.id === trackId);
    const hasKnead = track?.devices.some((d) => d.type.toLowerCase() === 'knead') ?? false;

    const kneadStoreState = useStore(kneadStore, {
        activeTrackId: null,
        tracks: {},
        isAnalyzing: false,
        analysisProgress: 0,
    });
    const kneadState = kneadStoreState.tracks[trackId];

    // Auto-analyze mock hook when enabled
    useEffect(() => {
        if (hasKnead && (!kneadState || kneadState.blobs.length === 0)) {
            // Mock automatic analysis simulating a WASM pitch detection pass
            const timer = setTimeout(() => {
                ingestDspAnalysis(trackId, [
                    // A3 (needs >5 frames)
                    { time: 0.5, f0: 220.0, periodicity: 0.9 },
                    { time: 0.6, f0: 221.0, periodicity: 0.9 },
                    { time: 0.7, f0: 220.5, periodicity: 0.9 },
                    { time: 0.8, f0: 219.0, periodicity: 0.9 },
                    { time: 0.9, f0: 220.0, periodicity: 0.9 },
                    { time: 1.0, f0: 220.1, periodicity: 0.9 },
                    { time: 1.1, f0: 219.5, periodicity: 0.9 },
                    { time: 1.2, f0: null, periodicity: 0.1 },
                    // E4
                    { time: 1.5, f0: 329.63, periodicity: 0.9 },
                    { time: 1.6, f0: 330.0, periodicity: 0.9 },
                    { time: 1.7, f0: 331.0, periodicity: 0.9 },
                    { time: 1.8, f0: 329.0, periodicity: 0.9 },
                    { time: 1.9, f0: 329.5, periodicity: 0.9 },
                    { time: 2.0, f0: 330.5, periodicity: 0.9 },
                    { time: 2.1, f0: null, periodicity: 0.1 },
                    // C4
                    { time: 2.5, f0: 261.63, periodicity: 0.9 },
                    { time: 2.6, f0: 262.0, periodicity: 0.9 },
                    { time: 2.7, f0: 261.0, periodicity: 0.9 },
                    { time: 2.8, f0: 261.5, periodicity: 0.9 },
                    { time: 2.9, f0: 262.5, periodicity: 0.9 },
                    { time: 3.0, f0: 261.0, periodicity: 0.9 },
                    { time: 3.1, f0: null, periodicity: 0.1 },
                ]);
            }, 600); // give it a slightly satisfying "thinking" pause
            return () => clearTimeout(timer);
        }
    }, [hasKnead, kneadState, trackId]);

    // Render loop for the Canvas-based Blob Editor
    useEffect(() => {
        if (!hasKnead) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const style = getComputedStyle(document.documentElement);
        const bgCol = `hsl(${style.getPropertyValue('--color-surface-sunken') || '0, 0%, 8%'})`;
        const accentCol = `hsl(${style.getPropertyValue('--color-accent-orange') || '24, 100%, 50%'})`;

        let animationFrameId: number;

        const render = () => {
            const width = canvas.width;
            const height = canvas.height;

            // Clear background
            ctx.fillStyle = bgCol;
            ctx.fillRect(0, 0, width, height);

            // Draw Piano Roll horizontal grid lanes
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            const rowHeight = 24;
            for (let y = 0; y < height; y += rowHeight) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Draw Knead Blobs
            if (kneadState && kneadState.blobs.length > 0) {
                const avgCents =
                    kneadState.blobs.reduce((a, b) => a + (b.pitchCenterCents || 6000), 0) / kneadState.blobs.length;

                for (const blob of kneadState.blobs) {
                    if (!blob.pitchCenterCents) continue;

                    // Map time to X (zoomed for visibility)
                    const x = blob.startTime * 300;
                    const w = (blob.endTime - blob.startTime) * 300;

                    // Map cents to Y
                    const y = height / 2 - ((blob.pitchCenterCents - avgCents) / 100) * rowHeight;

                    // Draw outer blob shape
                    ctx.fillStyle = accentCol;
                    ctx.globalAlpha = blob.voicedConfidence > 0.5 ? 0.8 : 0.3;
                    ctx.beginPath();
                    ctx.roundRect(x, y - rowHeight / 2 + 2, w, rowHeight - 4, 4);
                    ctx.fill();

                    // Draw internal pitch curve
                    if (blob.pitchCurveCents.length > 0) {
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.globalAlpha = 1.0;
                        ctx.beginPath();
                        const step = w / blob.pitchCurveCents.length;
                        for (let i = 0; i < blob.pitchCurveCents.length; i++) {
                            const px = x + i * step;
                            const py = y - ((blob.pitchCurveCents[i] || 0) / 100) * rowHeight;
                            if (i === 0) ctx.moveTo(px, py);
                            else ctx.lineTo(px, py);
                        }
                        ctx.stroke();
                    }
                }
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '12px var(--font-sans)';
                ctx.textAlign = 'center';
                ctx.fillText('No pitch data analyzed.', width / 2, height / 2);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [kneadState, hasKnead]);

    useLayoutEffect(() => {
        const resizeCanvas = () => {
            if (canvasRef.current) {
                const parent = canvasRef.current.parentElement;
                if (parent) {
                    canvasRef.current.width = parent.clientWidth;
                    canvasRef.current.height = parent.clientHeight;
                }
            }
        };
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        return () => window.removeEventListener('resize', resizeCanvas);
    }, []);

    return (
        <div className="flex flex-col flex-1 w-full relative bg-surface-sunken overflow-hidden">
            {hasKnead && kneadState && kneadState.blobs.length > 0 ? (
                <div className="absolute top-0 left-0 right-0 h-10 bg-surface-base/90 backdrop-blur-md border-b flex items-center px-4 gap-6 z-20 shadow-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground w-12 text-right">
                            Retune
                        </span>
                        <Slider
                            className="w-24"
                            value={[kneadState.retuneSpeedMs ?? 25]}
                            min={0}
                            max={200}
                            step={1}
                            onValueChange={([val]) =>
                                updateTrackKneadState(trackId, (s) => ({ ...s, retuneSpeedMs: val ?? 25 }))
                            }
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground w-12 text-right">
                            Human
                        </span>
                        <Slider
                            className="w-24"
                            value={[kneadState.humanizePercent ?? 40]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={([val]) =>
                                updateTrackKneadState(trackId, (s) => ({ ...s, humanizePercent: val ?? 40 }))
                            }
                        />
                    </div>
                    <div className="flex items-center gap-2 px-3 border-l border-border">
                        <DawCompactCheckbox
                            checked={kneadState.formantPreserve ?? true}
                            onChange={(e) =>
                                updateTrackKneadState(trackId, (s) => ({ ...s, formantPreserve: e.target.checked }))
                            }
                            className="cursor-pointer"
                            id="formant-toggle"
                        />
                        <label
                            htmlFor="formant-toggle"
                            className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer"
                        >
                            Formants
                        </label>
                    </div>
                </div>
            ) : null}

            <div className="flex-1 w-full relative overflow-auto">
                <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-[600px] cursor-crosshair min-w-[800px]"
                />
            </div>

            {!hasKnead ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm">
                    <Mic className="size-8 text-muted-foreground/50 mb-3" />
                    <p className="text-sm font-medium mb-1">Pitch Correction Disabled</p>
                    <p className="text-xs text-muted-foreground mb-4 max-w-xs text-center">
                        Enable Knead on this track to analyze and edit the pitch of this audio clip in real-time.
                    </p>
                    <Button onClick={() => addDevice(trackId, 'Knead')} variant="default" size="sm">
                        Enable Pitch Editor
                    </Button>
                </div>
            ) : !kneadState || kneadState.blobs.length === 0 ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-surface-base/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-2 mb-4">
                        <div className="size-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                        <p className="text-xs text-muted-foreground font-medium">Analyzing pitch tracking data...</p>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

/**
 * IrBrowser — impulse response file loader with drag-and-drop.
 *
 * Drop zone accepts WAV/AIFF files. Decodes the file through the shared
 * AudioContext, shows the IR waveform, and hands the decoded interleaved
 * samples to the `onIrLoaded` callback. Routing that data into the reverb
 * engine is the caller's responsibility — this component does not touch the
 * engine itself.
 */
import { type ReactElement, useState, useRef, useEffect, type DragEvent } from 'react';

import { Upload } from 'lucide-react';

import { logger } from '#/infra/logger/appLogger';
import { getAudioContext } from '#/modules/AudioEngine/useCases';

type IrBrowserProps = {
    onIrLoaded: (data: Float32Array, channels: number, sampleRate: number) => void;
};

export const IrBrowser = ({ onIrLoaded }: IrBrowserProps): ReactElement => {
    const [irName, setIrName] = useState<string | null>(null);
    const [waveform, setWaveform] = useState<number[] | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const handleDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
        event.preventDefault();
        setIsDragging(false);

        const file = event.dataTransfer.files[0];
        if (!file) {
            return;
        }

        // Accept WAV, AIFF, FLAC
        const validTypes = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/aiff', 'audio/x-aiff', 'audio/flac'];
        if (!validTypes.includes(file.type) && !file.name.match(/\.(wav|aiff|aif|flac)$/i)) {
            return;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            // §179.1 — decode through the shared AudioContext instead of
            // instantiating an orphaned OfflineAudioContext that was never
            // started or cleaned up.
            const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer);

            const channels = audioBuffer.numberOfChannels;
            const frameCount = audioBuffer.length;
            const sampleRate = audioBuffer.sampleRate;

            // Interleave
            const data = new Float32Array(frameCount * channels);
            for (let ch = 0; ch < channels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let index = 0; index < frameCount; index++) {
                    data[index * channels + ch] = channelData[index] ?? 0;
                }
            }

            setIrName(file.name);
            onIrLoaded(data, channels, sampleRate);

            // Generate waveform preview (downsample to 200 points)
            const mono = audioBuffer.getChannelData(0);
            const points = 200;
            const samplesPerPoint = Math.floor(mono.length / points);
            const preview: number[] = [];
            for (let param = 0; param < points; param++) {
                let peak = 0;
                for (let state = 0; state < samplesPerPoint; state++) {
                    const val = Math.abs(mono[param * samplesPerPoint + state] ?? 0);
                    if (val > peak) {
                        peak = val;
                    }
                }
                preview.push(peak);
            }
            setWaveform(preview);
        } catch (error) {
            logger.warn('[ProofChamber] Failed to decode IR:', error);
        }
    };

    // Draw waveform
    useEffect(() => {
        if (!waveform || !canvasRef.current) {
            return;
        }
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(127,184,196,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < waveform.length; index++) {
            const x = (index / waveform.length) * w;
            const amp = waveform[index] ?? 0;
            const y = h / 2 - amp * h * 0.45;
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        // Mirror for bottom half
        for (let index = waveform.length - 1; index >= 0; index--) {
            const x = (index / waveform.length) * w;
            const amp = waveform[index] ?? 0;
            const y = h / 2 + amp * h * 0.45;
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(127,184,196,0.15)';
        ctx.fill();
        ctx.stroke();
    }, [waveform]);

    return (
        <div className="flex flex-col gap-1">
            <span className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Impulse Response</span>
            {/* Drop zone */}
            <div
                className={`relative rounded border-2 border-dashed transition-colors cursor-pointer ${
                    isDragging
                        ? 'border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/10'
                        : 'border-border/30 hover:border-border/50'
                }`}
                style={{ minHeight: waveform ? 50 : 40 }}
                onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                    void handleDrop(event);
                }}
            >
                {waveform ? (
                    <div className="relative">
                        <canvas ref={canvasRef} width={300} height={50} className="w-full h-[50px] rounded" />
                        <span className="absolute bottom-1 left-2 text-[7px] text-[var(--color-accent-cyan)]/60">
                            {irName}
                        </span>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-1 py-2 text-muted-foreground/40">
                        <Upload className="size-3" />
                        <span className="text-[8px]">Drop WAV/AIFF here</span>
                    </div>
                )}
            </div>
        </div>
    );
};

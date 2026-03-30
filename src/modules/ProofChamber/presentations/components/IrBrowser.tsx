/**
 * IrBrowser — impulse response file loader with drag-and-drop.
 *
 * Drop zone accepts WAV/AIFF files. Decodes and shows the IR waveform.
 * Sends the decoded IR data to the Dutch Oven engine.
 */
import { type ReactElement, useState, useRef, useEffect, type DragEvent } from 'react';
import { Upload } from 'lucide-react';

type IrBrowserProps = {
    onIrLoaded: (data: Float32Array, channels: number, sampleRate: number) => void;
};

export const IrBrowser = ({ onIrLoaded }: IrBrowserProps): ReactElement => {
    const [irName, setIrName] = useState<string | null>(null);
    const [waveform, setWaveform] = useState<number[] | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const handleDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
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
            const ctx = new OfflineAudioContext(2, 44100, 44100);
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            const channels = audioBuffer.numberOfChannels;
            const frameCount = audioBuffer.length;
            const sampleRate = audioBuffer.sampleRate;

            // Interleave
            const data = new Float32Array(frameCount * channels);
            for (let ch = 0; ch < channels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < frameCount; i++) {
                    data[i * channels + ch] = channelData[i] ?? 0;
                }
            }

            setIrName(file.name);
            onIrLoaded(data, channels, sampleRate);

            // Generate waveform preview (downsample to 200 points)
            const mono = audioBuffer.getChannelData(0);
            const points = 200;
            const samplesPerPoint = Math.floor(mono.length / points);
            const preview: number[] = [];
            for (let p = 0; p < points; p++) {
                let peak = 0;
                for (let s = 0; s < samplesPerPoint; s++) {
                    const val = Math.abs(mono[p * samplesPerPoint + s] ?? 0);
                    if (val > peak) {
                        peak = val;
                    }
                }
                preview.push(peak);
            }
            setWaveform(preview);
        } catch (err) {
            console.warn('[ProofChamber] Failed to decode IR:', err);
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
        for (let i = 0; i < waveform.length; i++) {
            const x = (i / waveform.length) * w;
            const amp = waveform[i] ?? 0;
            const y = h / 2 - amp * h * 0.45;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        // Mirror for bottom half
        for (let i = waveform.length - 1; i >= 0; i--) {
            const x = (i / waveform.length) * w;
            const amp = waveform[i] ?? 0;
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
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                    void handleDrop(e);
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

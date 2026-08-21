/**
 * IrBrowser — impulse response file loader with drag-and-drop.
 *
 * Drop zone accepts WAV/AIFF files. The owning Plugin view supplies the
 * decoded interleaved samples and waveform preview, while this component
 * handles the drop interaction and presentation. Routing that data into the
 * reverb engine is the caller's responsibility.
 */
import { type ReactElement, useState, useRef, useEffect, type DragEvent } from 'react';

import { Upload } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { logger } from '#/infra/logger/appLogger';

type IrBrowserDecodeResult = {
    data: Float32Array;
    channels: number;
    sampleRate: number;
    waveform: number[];
};

type IrBrowserProps = {
    onFileDrop: (file: File) => Promise<IrBrowserDecodeResult>;
    onIrLoaded: (data: Float32Array, channels: number, sampleRate: number) => void;
};

export const IrBrowser = ({ onFileDrop, onIrLoaded }: IrBrowserProps): ReactElement => {
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
            const { data, channels, sampleRate, waveform: preview } = await onFileDrop(file);

            setIrName(file.name);
            onIrLoaded(data, channels, sampleRate);
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
        <Stack gap={1}>
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
                    <Row justify="center" gap={1} className="py-2 text-muted-foreground/40">
                        <Upload className="size-3" />
                        <span className="text-[8px]">Drop WAV/AIFF here</span>
                    </Row>
                )}
            </div>
        </Stack>
    );
};

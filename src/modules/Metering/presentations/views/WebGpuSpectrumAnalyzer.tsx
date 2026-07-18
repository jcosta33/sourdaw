import { type ReactElement, useRef, useEffect } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterAnalyser, getTrackAnalyser, getAudioSampleRate } from '#/modules/AudioEngine/useCases';

import { createWebGpuSpectrumRenderer, type SpectrumRenderer } from '../renderers/createWebGpuSpectrumRenderer';

type WebGpuSpectrumAnalyzerProps = {
    trackId?: string;
    width?: number;
    height?: number;
    showHeatmap?: boolean;
};

export const WebGpuSpectrumAnalyzer = ({
    trackId,
    width = 300,
    height = 120,
    showHeatmap = false,
}: WebGpuSpectrumAnalyzerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<SpectrumRenderer | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        let disposed = false;
        const analyser = trackId ? (getTrackAnalyser(trackId) ?? getMasterAnalyser()) : getMasterAnalyser();
        const numBins = analyser.frequencyBinCount;
        const sampleRate = getAudioSampleRate();

        async function init() {
            const renderer = await createWebGpuSpectrumRenderer(canvas!, numBins, sampleRate);
            if (disposed) {
                renderer?.dispose();
                return;
            }
            rendererRef.current = renderer;
            renderer?.resize(width, height);
        }

        void init();

        let rafId = 0;
        const freqData = new Float32Array(numBins);

        const draw = () => {
            if (rendererRef.current) {
                analyser.getFloatFrequencyData(freqData);
                rendererRef.current.render(freqData, showHeatmap);
            }
            rafId = requestAnimationFrame(draw);
        };

        draw();

        return () => {
            disposed = true;
            cancelAnimationFrame(rafId);
            rendererRef.current?.dispose();
        };
    }, [trackId, width, height, showHeatmap]);

    return (
        <DawMeterFrame>
            <canvas ref={canvasRef} className="block" aria-label="WebGPU Spectrum analyzer" role="img" />
        </DawMeterFrame>
    );
};

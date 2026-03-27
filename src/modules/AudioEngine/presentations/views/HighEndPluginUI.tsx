import { useEffect, useRef, useState } from 'react';
import type { WAMInstance } from '#/modules/Plugin/useCases/wamPluginHost/hostOperations';
import { type ParameterSAB } from '../../engine/ParameterSAB';

type HighEndPluginUIProps = {
    instance: WAMInstance;
    parameterSab: ParameterSAB;
    onClose?: () => void;
};

/**
 * A generic WebGPU-based immediate-mode GUI shell for High-End Factory Plugins
 * (Alchemy, Space Designer, Pro EQ).
 *
 * Instead of retaining a DOM tree of inputs/knobs, this UI mounts a single <canvas>
 * and uses WebGPU to render the entire UI surface at 60fps. The state is synchronized
 * directly with the AudioWorklet via lock-free SharedArrayBuffers (ParameterSAB).
 */
export function HighEndPluginUI({ instance, parameterSab, onClose }: HighEndPluginUIProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const deviceRef = useRef<GPUDevice | null>(null);
    const [webGpuSupported, setWebGpuSupported] = useState<boolean>(true);

    useEffect(() => {
        let animationFrameId: number;

        async function initWebGPU() {
            if (!navigator.gpu) {
                console.warn('[HighEndPluginUI] WebGPU not supported on this browser.');
                setWebGpuSupported(false);
                return;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('[HighEndPluginUI] Failed to get WebGPU adapter.');
                setWebGpuSupported(false);
                return;
            }

            const device = await adapter.requestDevice();
            deviceRef.current = device;
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }

            const context = canvas.getContext('webgpu');
            if (!context) {
                console.warn('[HighEndPluginUI] Failed to get webgpu context.');
                setWebGpuSupported(false);
                return;
            }

            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device,
                format,
                alphaMode: 'premultiplied',
            });

            // Very basic clearing pass just to prove the WebGPU pipeline works.
            // In a real implementation, this would contain the immediate-mode GUI draw list,
            // parsing parameters, rendering knobs/meters/spectrograms.
            function render() {
                // Example of reading a parameter (e.g., gain/mix) and visualizing it
                // const masterGain = parameterSab.getParameterValue('Mix');

                const commandEncoder = device.createCommandEncoder();
                const textureView = context!.getCurrentTexture().createView();

                const renderPassDescriptor: GPURenderPassDescriptor = {
                    colorAttachments: [
                        {
                            view: textureView,
                            clearValue: { r: 0.1, g: 0.1, b: 0.12, a: 1.0 }, // Dark theme background
                            loadOp: 'clear',
                            storeOp: 'store',
                        },
                    ],
                };

                const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
                passEncoder.end();

                device.queue.submit([commandEncoder.finish()]);

                animationFrameId = requestAnimationFrame(render);
            }

            render();
        }

        initWebGPU();

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            // Release GPU resources
            if (deviceRef.current) {
                deviceRef.current.destroy();
                deviceRef.current = null;
            }
        };
    }, [parameterSab]);

    return (
        <div className="flex h-[400px] w-full max-w-[800px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
            {/* Header / Top Bar */}
            <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-2">
                <div className="flex flex-col">
                    <span className="font-semibold text-foreground">{instance.descriptor.name}</span>
                    <span className="text-xs text-muted-foreground">
                        {instance.descriptor.vendor} ({instance.descriptor.category})
                    </span>
                </div>
                {onClose ? (
                    <button
                        onClick={onClose}
                        className="rounded bg-surface p-1 text-muted hover:bg-surface-hover hover:text-foreground active:bg-surface-active"
                    >
                        Close
                    </button>
                ) : null}
            </div>

            {/* WebGPU Canvas Area */}
            <div className="flex-1 bg-black">
                {webGpuSupported ? (
                    <canvas ref={canvasRef} className="block h-full w-full" width={800} height={350} />
                ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                        <div className="text-center">
                            <p className="mb-2 text-lg font-medium text-destructive">WebGPU Not Supported</p>
                            <p className="text-sm">This high-end plugin requires WebGPU for its UI rendering.</p>
                            <p className="text-sm">
                                Please use a compatible browser (e.g. Chrome/Edge 113+ or Safari 18+).
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

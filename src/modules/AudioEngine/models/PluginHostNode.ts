import { processAudioIPC } from '#/modules/Plugin/useCases/pluginLifecycle';

/**
 * A wrapper around the AudioWorkletNode that proxies audio blocks
 * between the Web Audio graph and the Rust Native Plugin Host via Tauri IPC.
 */
export class PluginHostNode extends AudioWorkletNode {
    private instanceId: string;
    private isProcessing: boolean = false;

    constructor(context: BaseAudioContext, instanceId: string) {
        super(context, 'native-plugin-host-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
        });

        this.instanceId = instanceId;

        // Initialize the worklet processor with our Rust instance ID
        this.port.postMessage({
            type: 'init',
            instanceId: this.instanceId,
        });

        // Listen for Float32Array arrays coming from the worklet to process natively
        this.port.onmessage = async (event) => {
            if (event.data.type === 'process') {
                await this.handleProcessTick(event.data);
            }
        };
    }

    private async handleProcessTick(data: { channels: number; samples: number; buffer: ArrayBuffer }) {
        if (this.isProcessing) {
            return;
        } // Prevent IPC flood if Rust is lagging
        this.isProcessing = true;

        const inputData = new Float32Array(data.buffer);

        // Send to Rust for DSP
        const outputData = await processAudioIPC(this.instanceId, inputData);

        // Send the processed result back down to the worklet to write to the `outputs` slice
        this.port.postMessage(
            { type: 'processed', buffer: outputData.buffer },
            [outputData.buffer] // Transfer ownership
        );

        this.isProcessing = false;
    }
}

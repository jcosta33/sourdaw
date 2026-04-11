import { fetchAndDecode } from './helpers';

/**
 * Load a single sample for quick preview / audition.
 * Returns the sampleId assigned in the engine.
 */
export async function loadSingleSample(url: string, nodePort: MessagePort, sampleId: number): Promise<number> {
    const { data, frameCount, channels, sampleRate } = await fetchAndDecode(url);

    const transferable = data.buffer;
    nodePort.postMessage(
        {
            type: 'addSample',
            sampleId,
            data,
            frameCount,
            channels,
            sampleRate,
        },
        [transferable]
    );

    return sampleId;
}
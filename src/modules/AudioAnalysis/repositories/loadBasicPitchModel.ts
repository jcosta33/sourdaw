import { BasicPitch } from '@spotify/basic-pitch';
import basicPitchWeightsUrl from '@spotify/basic-pitch/model/group1-shard1of1.bin?url';
import basicPitchModelUrl from '@spotify/basic-pitch/model/model.json?url';
import { loadGraphModel } from '@tensorflow/tfjs';

export async function loadBasicPitchModel(): Promise<BasicPitch> {
    const model = await loadGraphModel(basicPitchModelUrl, {
        // Vite fingerprints each asset independently; the manifest's relative
        // filename is not the emitted weight URL.
        weightUrlConverter: async (filename) => {
            if (filename !== 'group1-shard1of1.bin') {
                throw new Error(`Unbundled Basic Pitch weight file: ${filename}`);
            }
            return basicPitchWeightsUrl;
        },
    });
    return new BasicPitch(Promise.resolve(model));
}

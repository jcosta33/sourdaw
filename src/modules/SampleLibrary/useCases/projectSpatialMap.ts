import { persistSamples } from '../repositories/libraryPersistence/persistSamples';
import { embeddingStore } from '../stores/embeddingStore';
import { libraryStore } from '../stores/libraryStore';

/**
 * Project high-dimensional embeddings to 2D space using UMAP-style logic.
 * R-G3: 2D Spatial Map.
 */
export async function projectSpatialMap(): Promise<void> {
    const embedState = embeddingStore.value;
    const libState = libraryStore.value;
    if (!embedState || !libState) {
        return;
    }

    const nextSamples = [...libState.samples];
    let changed = false;

    for (let i = 0; i < nextSamples.length; i++) {
        const sample = nextSamples[i]!;
        if (sample.spatialMap) {
            continue;
        }

        const vector = embedState.embeddings.get(sample.id);
        if (vector) {
            // Placeholder for actual UMAP: deterministic projection based on vector sums
            // In a real implementation, we'd use a UMAP JS library.
            let sumX = 0;
            let sumY = 0;
            for (let j = 0; j < vector.length; j++) {
                if (j % 2 === 0) {
                    sumX += vector[j]!;
                } else {
                    sumY += vector[j]!;
                }
            }

            nextSamples[i] = {
                ...sample,
                spatialMap: {
                    x: Math.tanh(sumX),
                    y: Math.tanh(sumY),
                },
            };
            changed = true;
        }
    }

    if (changed) {
        libraryStore.set({ ...libState, samples: nextSamples });
        await persistSamples();
    }
}

import { cacheFactoryBuffers } from './cacheFactoryBuffers';
import { renderFactoryLibraryPack } from './renderFactoryLibraryPack';

/**
 * The explicit repair: render the pack again and cache every sample that has
 * no stored audio. A sample with stored PCM keeps it.
 */
export async function rescanFactoryLibrary(ctx: AudioContext): Promise<void> {
    const samples = await renderFactoryLibraryPack(ctx);
    await cacheFactoryBuffers(samples);
}

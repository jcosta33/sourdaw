import { persistSamples } from '../repositories/libraryPersistence/persistSamples';
import { toggleSampleFavorite } from '../stores/libraryStore';

/**
 * Toggle a sample's favorite flag and persist the change.
 *
 * Favoriting is a durable user edit, so the in-memory flip must be flushed to
 * IndexedDB on its own write path — otherwise the favorite only survives if an
 * unrelated scan/disconnect happens to call {@link persistSamples} first, and is
 * lost on reload otherwise. A store never writes to repositories directly, so the
 * persist lives here in the use case rather than in {@link toggleSampleFavorite}.
 */
export async function toggleFavorite(sampleId: string): Promise<void> {
    toggleSampleFavorite(sampleId);
    await persistSamples();
}

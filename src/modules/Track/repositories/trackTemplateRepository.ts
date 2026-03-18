import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { type TrackTemplate } from '../models/TrackTemplate';

const storage = new LocalStorageStorage<TrackTemplate[]>('webdaw:track-templates');

export function loadTrackTemplates(): TrackTemplate[] {
    return storage.get() ?? [];
}

export function saveTrackTemplates(templates: TrackTemplate[]): void {
    storage.set(templates);
}

import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';
import { type TrackTemplate } from '../models/TrackTemplate';

const storage = createLocalStorage<TrackTemplate[]>('sourdaw:track-templates');

export function loadTrackTemplates(): TrackTemplate[] {
    return storage.get() ?? [];
}

export function saveTrackTemplates(templates: TrackTemplate[]): void {
    storage.set(templates);
}

import { type TrackTemplate } from '../../models/TrackTemplate';
import { storage } from './helpers';

export function saveTrackTemplates(templates: TrackTemplate[]): void {
    storage.set(templates);
}
import { type TrackTemplate } from '../../models/TrackTemplate';
import { storage } from './helpers';

export function loadTrackTemplates(): TrackTemplate[] {
    return storage.get() ?? [];
}
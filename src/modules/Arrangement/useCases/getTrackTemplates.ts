import { type TrackTemplate } from '../models/TrackTemplate';
import { loadTrackTemplates } from '../repositories/trackTemplate/loadTrackTemplates';

import { trackTemplateCache } from './trackTemplate';

export function getTrackTemplates(): readonly TrackTemplate[] {
    let cachedTemplates = trackTemplateCache.templates;
    if (cachedTemplates === null) {
        cachedTemplates = loadTrackTemplates();
        trackTemplateCache.templates = cachedTemplates;
    }

    return cachedTemplates;
}

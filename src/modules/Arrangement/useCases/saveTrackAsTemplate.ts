import { type TrackTemplate } from '../models/TrackTemplate';
import { getTrackById } from '../repositories/track/getTrackById';
import { loadTrackTemplates } from '../repositories/trackTemplate/loadTrackTemplates';
import { saveTrackTemplates } from '../repositories/trackTemplate/saveTrackTemplates';

import { trackTemplateCache } from './trackTemplate';

export function saveTrackAsTemplate(trackId: string, name: string, category?: string): TrackTemplate | null {
    const track = getTrackById(trackId);
    if (!track) {
        return null;
    }

    const template: TrackTemplate = {
        id: `tmpl-${crypto.randomUUID().slice(0, 8)}`,
        name,
        category: category ?? 'User',
        createdAt: Date.now(),
        trackKind: track.kind,
        devices: track.devices.map((device) => ({ ...device })),
        sends: track.sends.map((send) => ({ ...send })),
        gain: track.gain,
        pan: track.pan,
        color: track.color,
    };

    let cachedTemplates = trackTemplateCache.templates;
    if (cachedTemplates === null) {
        cachedTemplates = loadTrackTemplates();
        trackTemplateCache.templates = cachedTemplates;
    }

    // Build the new list immutably so callers holding a reference to
    // the previously-cached array don't see surprise mutations (§78.1).
    const templates = [...cachedTemplates, template];
    saveTrackTemplates(templates);
    trackTemplateCache.templates = templates;

    return template;
}

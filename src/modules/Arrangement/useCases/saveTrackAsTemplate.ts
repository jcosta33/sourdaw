import { findWithheldDeviceType } from '#/infra/release/deviceReleaseAdmission';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
    const withheldDeviceType = findWithheldDeviceType(track.devices);
    if (withheldDeviceType) {
        notifyUser(
            `Track contains withheld device "${withheldDeviceType}" and was not saved as a template.`,
            'warning'
        );
        return null;
    }

    const template: TrackTemplate = {
        id: `tmpl-${crypto.randomUUID().slice(0, 8)}`,
        name,
        category: category ?? 'User',
        createdAt: Date.now(),
        trackKind: track.kind,
        // Saved templates carry each plugin's state chunk (the sound) but not the live
        // instance id — a persisted instance id would dangle or collide on load (PH-3).
        devices: track.devices.map((device) => ({ ...device, externalInstanceId: undefined })),
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

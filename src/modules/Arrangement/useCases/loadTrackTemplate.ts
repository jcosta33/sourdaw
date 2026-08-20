import { findWithheldDeviceType } from '#/infra/release/deviceReleaseAdmission';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createTrack } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { loadTrackTemplates } from '../repositories/trackTemplate/loadTrackTemplates';

import { trackTemplateCache } from './trackTemplate';

export function loadTrackTemplate(templateId: string): void {
    let cachedTemplates = trackTemplateCache.templates;
    if (cachedTemplates === null) {
        cachedTemplates = loadTrackTemplates();
        trackTemplateCache.templates = cachedTemplates;
    }

    const template = cachedTemplates.find((trackTemplate) => trackTemplate.id === templateId);
    if (!template) {
        return;
    }
    const withheldDeviceType = findWithheldDeviceType(template.devices);
    if (withheldDeviceType) {
        notifyUser(`Template contains withheld device "${withheldDeviceType}" and was not loaded.`, 'warning');
        return;
    }

    const track = createTrack({ name: template.name, kind: template.trackKind });
    const applied = {
        ...track,
        devices: template.devices.map((device) => ({
            ...device,
            id: `dev-${crypto.randomUUID().slice(0, 8)}`,
            // A template-instantiated native plugin must not reuse the template's live
            // host instance id: clear it so the device starts dormant and gets its own
            // instance on activation, while the copied externalStateChunk carries the
            // sound (PH-3). Also guards legacy templates saved with a stale instance id.
            externalInstanceId: undefined,
        })),
        sends: template.sends.map((send) => ({ ...send })),
        gain: template.gain,
        pan: template.pan,
        color: template.color,
    };

    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: [...state.tracks, applied],
    });
}

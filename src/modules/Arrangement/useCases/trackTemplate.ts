import { createTrack } from '../models/Track';
import { type TrackTemplate } from '../models/TrackTemplate';
import { getTrackById } from '../repositories/track/getTrackById';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { loadTrackTemplates } from '../repositories/trackTemplate/loadTrackTemplates';
import { saveTrackTemplates } from '../repositories/trackTemplate/saveTrackTemplates';

let templateCache: TrackTemplate[] | null = null;

function ensureCache(loadFn: typeof loadTrackTemplates): TrackTemplate[] {
    if (templateCache === null) {
        templateCache = loadFn();
    }
    return templateCache;
}

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
        devices: track.devices.map((data) => ({ ...data })),
        sends: track.sends.map((state) => ({ ...state })),
        gain: track.gain,
        pan: track.pan,
        color: track.color,
    };

    // Build the new list immutably so callers holding a reference to
    // the previously-cached array don't see surprise mutations (§78.1).
    const templates = [...ensureCache(loadTrackTemplates), template];
    saveTrackTemplates(templates);
    templateCache = templates;

    return template;
}

export function loadTrackTemplate(templateId: string): void {
    const templates = ensureCache(loadTrackTemplates);
    const template = templates.find((time) => time.id === templateId);
    if (!template) {
        return;
    }

    const track = createTrack({ name: template.name, kind: template.trackKind });
    const applied = {
        ...track,
        devices: template.devices.map((data) => ({ ...data, id: `dev-${crypto.randomUUID().slice(0, 8)}` })),
        sends: template.sends.map((state1) => ({ ...state1 })),
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

export function getTrackTemplates(): readonly TrackTemplate[] {
    return ensureCache(loadTrackTemplates);
}

export function deleteTrackTemplate(templateId: string): void {
    const templates = ensureCache(loadTrackTemplates);
    const filtered = templates.filter((time) => time.id !== templateId);
    saveTrackTemplates(filtered);
    templateCache = filtered;
}

import { type TrackTemplate } from '../models/TrackTemplate';
import { loadTrackTemplates, saveTrackTemplates } from '../repositories/trackTemplate';
import { getTrackById } from '../repositories/track/getTrackById';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { createTrack } from '../models/Track';

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
        devices: track.devices.map((d) => ({ ...d })),
        sends: track.sends.map((s) => ({ ...s })),
        gain: track.gain,
        pan: track.pan,
        color: track.color,
    };

    const templates = ensureCache(loadTrackTemplates);
    templates.push(template);
    saveTrackTemplates(templates);
    templateCache = templates;

    return template;
}

export function loadTrackTemplate(templateId: string): void {
    const templates = ensureCache(loadTrackTemplates);
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
        return;
    }

    const track = createTrack({ name: template.name, kind: template.trackKind });
    const applied = {
        ...track,
        devices: template.devices.map((d) => ({ ...d, id: `dev-${crypto.randomUUID().slice(0, 8)}` })),
        sends: template.sends.map((s) => ({ ...s })),
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

export function getTrackTemplates(): TrackTemplate[] {
    return ensureCache(loadTrackTemplates);
}

export function deleteTrackTemplate(templateId: string): void {
    const templates = ensureCache(loadTrackTemplates);
    const filtered = templates.filter((t) => t.id !== templateId);
    saveTrackTemplates(filtered);
    templateCache = filtered;
}

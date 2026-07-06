import { type TrackTemplate } from '../models/TrackTemplate';

export type TrackTemplateCache = {
    templates: TrackTemplate[] | null;
};

export const trackTemplateCache: TrackTemplateCache = {
    templates: null,
};

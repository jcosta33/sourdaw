import { loadTrackTemplates } from '../repositories/trackTemplate/loadTrackTemplates';
import { saveTrackTemplates } from '../repositories/trackTemplate/saveTrackTemplates';

import { trackTemplateCache } from './trackTemplate';

export function deleteTrackTemplate(templateId: string): void {
    let cachedTemplates = trackTemplateCache.templates;
    if (cachedTemplates === null) {
        cachedTemplates = loadTrackTemplates();
        trackTemplateCache.templates = cachedTemplates;
    }

    const filteredTemplates = cachedTemplates.filter((trackTemplate) => trackTemplate.id !== templateId);
    saveTrackTemplates(filteredTemplates);
    trackTemplateCache.templates = filteredTemplates;
}

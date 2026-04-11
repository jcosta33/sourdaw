import { filterTemplates as filterModelTemplates } from '../../models/midiPatternLibrary';
import { toPublicPatternTemplate } from './helpers';
type PatternTemplateFilters = Parameters<typeof filterModelTemplates>[0];

export function filterTemplates(filters: PatternTemplateFilters) {
    return filterModelTemplates(filters).map(toPublicPatternTemplate);
}
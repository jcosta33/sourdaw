import { filterTemplates as filterModelTemplates } from '../../models/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

type PatternTemplateFilters = Parameters<typeof filterModelTemplates>[0];

export function filterTemplates(filters: PatternTemplateFilters) {
    return filterModelTemplates(filters).map(toPublicPatternTemplate);
}

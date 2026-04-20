import { PATTERN_TEMPLATES as modelPatternTemplates } from '../../models/midiPatternLibrary';

import { toPublicPatternTemplate } from './helpers';

export const PATTERN_TEMPLATES = modelPatternTemplates.map(toPublicPatternTemplate);

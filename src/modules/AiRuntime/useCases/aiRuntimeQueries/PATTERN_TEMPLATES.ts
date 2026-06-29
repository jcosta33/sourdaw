import { PATTERN_TEMPLATES as modelPatternTemplates } from '../../models/MidiPatternLibrary';

import { toPublicPatternTemplate } from './helpers';

export const PATTERN_TEMPLATES = modelPatternTemplates.map(toPublicPatternTemplate);

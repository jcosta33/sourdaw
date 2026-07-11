import { PATTERN_TEMPLATES as modelPatternTemplates } from '../../models/MidiPatternLibrary';

import { toPublicPatternTemplate } from './toPublicPatternTemplate';

export const PATTERN_TEMPLATES = modelPatternTemplates.map(toPublicPatternTemplate);

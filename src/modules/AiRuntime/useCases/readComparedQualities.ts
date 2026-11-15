import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { type ComparedQuality, readComparedQualityWords } from './readComparedQualityWords';

/** Which qualities the request names, in any form; see readComparedQualityWords for the written words. */
export function readComparedQualities(
    prompt: string,
    context: AnswerInterpretationCatalog['context']
): ReadonlySet<ComparedQuality> {
    return new Set(readComparedQualityWords(prompt, context).keys());
}

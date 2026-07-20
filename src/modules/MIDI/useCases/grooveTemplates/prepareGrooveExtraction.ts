import { STRAIGHT_GROOVE_TEMPLATE_ID, type GrooveTemplate } from '../../models/GrooveTemplate';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';

import { createGrooveSourceRevision } from './createGrooveSourceRevision';
import { extractGrooveTemplate } from './extractGrooveTemplate';
import { prepareGrooveTemplateCreation } from './prepareGrooveTemplateCreation';

type PrepareGrooveExtractionInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
    templateId?: string;
};

type PrepareGrooveExtractionResult =
    | { status: 'extracted'; template: GrooveTemplate; sourceRevision: string }
    | { status: 'straight'; template: GrooveTemplate; sourceRevision: string }
    | { status: 'empty'; sourceRevision: string }
    | { status: 'unsupported'; sourceRevision: string }
    | { status: 'invalid-source'; reason: string; sourceRevision: string };

export function prepareGrooveExtraction({
    clipId,
    sourceName,
    subdivision,
    templateId,
}: PrepareGrooveExtractionInput): PrepareGrooveExtractionResult {
    const notes = getNotesForClip(clipId);
    const sourceRevision = createGrooveSourceRevision(notes);
    const result = extractGrooveTemplate({
        sourceId: clipId,
        sourceName,
        analyzerVersion: 1,
        subdivision,
        templateId,
        notes,
    });
    if (!result.ok) {
        if (result.error.code === 'empty-source') {
            return { status: 'empty', sourceRevision };
        }
        if (result.error.code === 'unsupported-subdivision') {
            return { status: 'unsupported', sourceRevision };
        }
        return { status: 'invalid-source', reason: result.error.reason, sourceRevision };
    }
    if (result.template.id === STRAIGHT_GROOVE_TEMPLATE_ID) {
        return { status: 'straight', template: result.template, sourceRevision };
    }
    return {
        status: 'extracted',
        template: prepareGrooveTemplateCreation(result.template),
        sourceRevision,
    };
}

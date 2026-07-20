import { trackStore } from '#/modules/Arrangement/stores';
import { extractGrooveTemplate, getNotesForClip, getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

type ProposeYeastGrooveExtractionInput = {
    clipId: string;
    subdivision: string;
};

type GrooveExtractionSource = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

type ExtractedGrooveTemplate = Extract<ReturnType<typeof extractGrooveTemplate>, { ok: true }>['template'];

type YeastGrooveExtractionProposal =
    | ({ status: 'extracted' | 'straight'; template: ExtractedGrooveTemplate } & GrooveExtractionSource)
    | ({ status: 'empty' | 'unsupported' } & GrooveExtractionSource)
    | ({ status: 'invalid-source'; reason: string } & GrooveExtractionSource)
    | { status: 'ineligible-clip'; clipId: string };

export function proposeYeastGrooveExtraction({
    clipId,
    subdivision,
}: ProposeYeastGrooveExtractionInput): YeastGrooveExtractionProposal {
    const trackState = trackStore.value;
    const clip = trackState?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip || clip.type !== 'midi') {
        return { status: 'ineligible-clip', clipId };
    }

    const source = {
        clipId,
        sourceName: clip.name,
        subdivision,
    };
    const result = extractGrooveTemplate({
        sourceId: clip.id,
        sourceName: clip.name,
        analyzerVersion: 1,
        subdivision,
        templateId: `groove-${clip.id}-v1`,
        notes: getNotesForClip(clip.id),
    });
    if (!result.ok) {
        if (result.error.code === 'empty-source') {
            return { status: 'empty', ...source };
        }
        if (result.error.code === 'unsupported-subdivision') {
            return { status: 'unsupported', ...source };
        }
        return { status: 'invalid-source', reason: result.error.reason, ...source };
    }
    if (result.template.id === getStraightGrooveTemplateId()) {
        return { status: 'straight', template: result.template, ...source };
    }
    return { status: 'extracted', template: result.template, ...source };
}

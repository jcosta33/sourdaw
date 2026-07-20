import { trackStore } from '#/modules/Arrangement/stores';
import { prepareGrooveExtraction } from '#/modules/MIDI/useCases';

type ProposeYeastGrooveExtractionInput = {
    clipId: string;
    subdivision: string;
};

type GrooveExtractionSource = {
    clipId: string;
    sourceName: string;
    subdivision: string;
};

type PreparedGrooveExtraction = ReturnType<typeof prepareGrooveExtraction>;
type ExtractedGrooveExtraction = Extract<PreparedGrooveExtraction, { status: 'extracted' }>;
type StraightGrooveExtraction = Extract<PreparedGrooveExtraction, { status: 'straight' }>;

type YeastGrooveExtractionProposal =
    | (ExtractedGrooveExtraction & GrooveExtractionSource)
    | ({ status: 'straight'; template: StraightGrooveExtraction['template'] } & GrooveExtractionSource)
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
    const result = prepareGrooveExtraction({
        clipId: clip.id,
        sourceName: clip.name,
        subdivision,
        templateId: `groove-${clip.id}-v1`,
    });
    if (result.status === 'extracted') {
        return { ...source, ...result };
    }
    if (result.status === 'straight') {
        return { ...source, status: result.status, template: result.template };
    }
    if (result.status === 'invalid-source') {
        return { ...source, status: result.status, reason: result.reason };
    }
    return { ...source, status: result.status };
}

import { prepareTempoAudioSourceWrite } from './comping/prepareTempoAudioSourceWrite';

export function canApplyTempoAudioSources(input: Parameters<typeof prepareTempoAudioSourceWrite>[0]): boolean {
    return prepareTempoAudioSourceWrite(input) !== null;
}

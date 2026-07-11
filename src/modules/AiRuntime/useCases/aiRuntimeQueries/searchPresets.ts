import { searchPresets as searchInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './toPromptPreset';

type SearchPresetsContext = {
    selectedTrackId: string | undefined;
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

type SearchPresetsOutput = Array<{
    preset: {
        id: string;
        label: string;
        category:
            | 'Transport'
            | 'Track'
            | 'Clip'
            | 'MIDI'
            | 'Device'
            | 'Workspace'
            | 'Mix'
            | 'Generate'
            | 'File'
            | 'Automation'
            | 'Collaboration';
        isDestructive: boolean;
    };
    score: number;
}>;

export function searchPresets(query: string, context: SearchPresetsContext, limit = 12): SearchPresetsOutput {
    return searchInternalPresets(query, context, limit).map((result) => ({
        preset: toPromptPreset(result.preset),
        score: result.score,
    }));
}

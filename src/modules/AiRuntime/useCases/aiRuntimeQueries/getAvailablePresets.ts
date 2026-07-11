import { getAvailablePresets as getAvailableInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './toPromptPreset';

type GetAvailablePresetsInput = {
    selectedTrackId: string | undefined;
    selectedClipId: string | undefined;
    selectedClipType: 'audio' | 'midi' | undefined;
    trackCount: number;
};

type GetAvailablePresetsOutput = Array<{
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
}>;

export function getAvailablePresets(context: GetAvailablePresetsInput): GetAvailablePresetsOutput {
    return getAvailableInternalPresets(context).map(toPromptPreset);
}

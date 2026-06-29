import { selectNativeAudioExportFile as selectAudioExportFile } from '../../repositories/audioExport/selectNativeAudioExportFile';

type SelectNativeAudioExportFileInput = {
    formats: string[];
    suggestedName: string;
};

type SelectNativeAudioExportFileOutput = Promise<string | null>;

export async function selectNativeAudioExportFile({
    formats,
    suggestedName,
}: SelectNativeAudioExportFileInput): SelectNativeAudioExportFileOutput {
    return selectAudioExportFile({ formats, suggestedName });
}

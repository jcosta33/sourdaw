import { selectNativeAudioExportDirectory as selectAudioExportDirectory } from '../../repositories/audioExport/selectNativeAudioExportDirectory';

type SelectNativeAudioExportDirectoryOutput = Promise<string | null>;

export async function selectNativeAudioExportDirectory(): SelectNativeAudioExportDirectoryOutput {
    return selectAudioExportDirectory();
}

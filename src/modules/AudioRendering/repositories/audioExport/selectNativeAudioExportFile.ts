import { desktopSaveDialog } from '#/utils/tauriBridge';

type SelectNativeAudioExportFileInput = {
    formats: string[];
    suggestedName: string;
};

type SelectNativeAudioExportFileOutput = Promise<string | null>;

export async function selectNativeAudioExportFile({
    formats,
    suggestedName,
}: SelectNativeAudioExportFileInput): SelectNativeAudioExportFileOutput {
    const filePath = await desktopSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: 'Audio File', extensions: formats }],
    });

    return filePath ?? null;
}

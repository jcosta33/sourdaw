import { desktopOpenDialog } from '#/utils/desktopBridge';

type SelectNativeAudioExportDirectoryOutput = Promise<string | null>;

export async function selectNativeAudioExportDirectory(): SelectNativeAudioExportDirectoryOutput {
    const selected = await desktopOpenDialog({
        directory: true,
        multiple: false,
        title: 'Select Output Folder for Slices (Stems)',
    });

    if (typeof selected !== 'string') {
        return null;
    }

    return selected;
}

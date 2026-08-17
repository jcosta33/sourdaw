import { desktopOpenDialog } from '#/utils/tauriBridge';

type PickTauriSampleFolderOutput = Promise<string | null>;

export async function pickTauriSampleFolder(): PickTauriSampleFolderOutput {
    const selected = await desktopOpenDialog({ directory: true, multiple: false, title: 'Connect Sample Folder' });

    if (typeof selected !== 'string') {
        return null;
    }

    return selected;
}

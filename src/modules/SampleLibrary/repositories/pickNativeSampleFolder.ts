import { desktopOpenDialog } from '#/utils/desktopBridge';

type PickNativeSampleFolderOutput = Promise<string | null>;

export async function pickNativeSampleFolder(): PickNativeSampleFolderOutput {
    const selected = await desktopOpenDialog({ directory: true, multiple: false, title: 'Connect Sample Folder' });

    if (typeof selected !== 'string') {
        return null;
    }

    return selected;
}

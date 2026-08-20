import { desktopSaveDialog } from '#/utils/desktopBridge';

type SaveDawProjectFileDialogInput = {
    suggestedName: string;
};

type SaveDawProjectFileDialogOutput = Promise<string | null>;

export async function saveDawProjectFileDialog({
    suggestedName,
}: SaveDawProjectFileDialogInput): SaveDawProjectFileDialogOutput {
    const filePath = await desktopSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
    });
    return filePath ?? null;
}

type SaveDawProjectFileDialogInput = {
    suggestedName: string;
};

type SaveDawProjectFileDialogOutput = Promise<string | null>;

export async function saveDawProjectFileDialog({
    suggestedName,
}: SaveDawProjectFileDialogInput): SaveDawProjectFileDialogOutput {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const filePath = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
    });
    return filePath ?? null;
}

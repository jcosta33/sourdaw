type SelectNativeAudioExportFileInput = {
    formats: string[];
    suggestedName: string;
};

type SelectNativeAudioExportFileOutput = Promise<string | null>;

export async function selectNativeAudioExportFile({
    formats,
    suggestedName,
}: SelectNativeAudioExportFileInput): SelectNativeAudioExportFileOutput {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const filePath = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Audio File', extensions: formats }],
    });

    return filePath ?? null;
}

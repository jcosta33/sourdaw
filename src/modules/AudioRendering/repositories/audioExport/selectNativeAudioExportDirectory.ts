type SelectNativeAudioExportDirectoryOutput = Promise<string | null>;

export async function selectNativeAudioExportDirectory(): SelectNativeAudioExportDirectoryOutput {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Output Folder for Slices (Stems)',
    });

    if (typeof selected !== 'string') {
        return null;
    }

    return selected;
}

type PickTauriSampleFolderOutput = Promise<string | null>;

export async function pickTauriSampleFolder(): PickTauriSampleFolderOutput {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title: 'Connect Sample Folder' });

    if (typeof selected !== 'string') {
        return null;
    }

    return selected;
}

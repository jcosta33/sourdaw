type WriteNativeAudioMixdownFileInput = {
    bytes: Uint8Array;
    format: string;
    selectedFilePath: string;
};

type WriteNativeAudioMixdownFileOutput = Promise<void>;

export async function writeNativeAudioMixdownFile({
    bytes,
    format,
    selectedFilePath,
}: WriteNativeAudioMixdownFileInput): WriteNativeAudioMixdownFileOutput {
    const adjustedPath = selectedFilePath.replace(/\.[a-z0-9]+$/i, `.${format}`);
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(adjustedPath, bytes);
}

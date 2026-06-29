type WriteNativeAudioStemFileInput = {
    bytes: Uint8Array;
    directoryPath: string;
    fileName: string;
};

type WriteNativeAudioStemFileOutput = Promise<void>;

export async function writeNativeAudioStemFile({
    bytes,
    directoryPath,
    fileName,
}: WriteNativeAudioStemFileInput): WriteNativeAudioStemFileOutput {
    const { join } = await import('@tauri-apps/api/path');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const filePath = await join(directoryPath, fileName);
    await writeFile(filePath, bytes);
}

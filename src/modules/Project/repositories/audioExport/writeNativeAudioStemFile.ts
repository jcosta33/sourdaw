import { invoke } from '@tauri-apps/api/core';

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
    const filePath = await join(directoryPath, fileName);
    await invoke('write_audio_file', { path: filePath, data: bytes });
}

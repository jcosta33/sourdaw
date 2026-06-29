import { invoke } from '@tauri-apps/api/core';

type WriteDawProjectFileInput = {
    bytes: Uint8Array;
    filePath: string;
};

type WriteDawProjectFileOutput = Promise<void>;

export async function writeDawProjectFile({ bytes, filePath }: WriteDawProjectFileInput): WriteDawProjectFileOutput {
    await invoke('write_audio_file', { path: filePath, data: bytes });
}

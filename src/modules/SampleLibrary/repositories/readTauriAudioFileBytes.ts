import { invoke } from '@tauri-apps/api/core';

type ReadTauriAudioFileBytesInput = {
    path: string;
};

type ReadTauriAudioFileBytesOutput = Promise<Uint8Array>;

export async function readTauriAudioFileBytes({
    path,
}: ReadTauriAudioFileBytesInput): ReadTauriAudioFileBytesOutput {
    const rawBytes: unknown = await invoke('read_audio_file', { path });

    if (!Array.isArray(rawBytes)) {
        throw new TypeError('read_audio_file returned a non-array payload');
    }

    const rawByteValues: readonly unknown[] = rawBytes;
    const bytes = new Uint8Array(rawByteValues.length);
    let byteIndex = 0;
    for (const rawByte of rawByteValues) {
        if (typeof rawByte !== 'number' || !Number.isInteger(rawByte) || rawByte < 0 || rawByte > 255) {
            throw new TypeError('read_audio_file returned an invalid byte payload');
        }
        bytes[byteIndex] = rawByte;
        byteIndex += 1;
    }

    return bytes;
}

import { readFileBytes } from '#/utils/tauriBridge';

type ReadTauriAudioFileBytesInput = {
    path: string;
};

type ReadTauriAudioFileBytesOutput = Promise<Uint8Array>;

export async function readTauriAudioFileBytes({ path }: ReadTauriAudioFileBytesInput): ReadTauriAudioFileBytesOutput {
    return readFileBytes({ path });
}

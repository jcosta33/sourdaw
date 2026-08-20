import { readFileBytes } from '#/utils/desktopBridge';

type ReadNativeAudioFileBytesInput = {
    path: string;
};

type ReadNativeAudioFileBytesOutput = Promise<Uint8Array>;

export async function readNativeAudioFileBytes({ path }: ReadNativeAudioFileBytesInput): ReadNativeAudioFileBytesOutput {
    return readFileBytes({ path });
}

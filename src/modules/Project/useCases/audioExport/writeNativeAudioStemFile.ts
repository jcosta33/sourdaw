import { writeNativeAudioStemFile as writeNativeAudioStemFileToDisk } from '../../repositories/audioExport/writeNativeAudioStemFile';

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
    await writeNativeAudioStemFileToDisk({ bytes, directoryPath, fileName });
}

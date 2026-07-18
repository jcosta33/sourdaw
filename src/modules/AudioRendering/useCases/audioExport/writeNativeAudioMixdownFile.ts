import { writeNativeAudioMixdownFile as writeNativeAudioMixdownFileToDisk } from '../../repositories/audioExport/writeNativeAudioMixdownFile';

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
    await writeNativeAudioMixdownFileToDisk({ bytes, format, selectedFilePath });
}

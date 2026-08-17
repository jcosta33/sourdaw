import { desktopPathJoin, writeFileBytes } from '#/utils/tauriBridge';

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
    const filePath = await desktopPathJoin(directoryPath, fileName);
    await writeFileBytes({ path: filePath, bytes });
}

import { writeFileBytes } from '#/utils/desktopBridge';

type WriteDawProjectFileInput = {
    bytes: Uint8Array;
    filePath: string;
};

type WriteDawProjectFileOutput = Promise<void>;

export async function writeDawProjectFile({ bytes, filePath }: WriteDawProjectFileInput): WriteDawProjectFileOutput {
    await writeFileBytes({ path: filePath, bytes });
}

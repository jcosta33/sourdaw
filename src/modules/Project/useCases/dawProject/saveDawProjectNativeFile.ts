import { saveDawProjectFileDialog } from '../../repositories/dawProject/saveDawProjectFileDialog';
import { writeDawProjectFile } from '../../repositories/dawProject/writeDawProjectFile';

type SaveDawProjectNativeFileInput = {
    bytes: Uint8Array;
    suggestedName: string;
};

type SaveDawProjectNativeFileOutput = Promise<void>;

export async function saveDawProjectNativeFile({
    bytes,
    suggestedName,
}: SaveDawProjectNativeFileInput): SaveDawProjectNativeFileOutput {
    const filePath = await saveDawProjectFileDialog({ suggestedName });
    if (!filePath) {
        return;
    }
    await writeDawProjectFile({ filePath, bytes });
}

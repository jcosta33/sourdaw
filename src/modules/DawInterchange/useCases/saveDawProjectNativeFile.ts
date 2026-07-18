import { saveDawProjectFileDialog } from '../repositories/saveDawProjectFileDialog';
import { writeDawProjectFile } from '../repositories/writeDawProjectFile';

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

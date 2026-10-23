import { saveDawProjectFileDialog } from '../repositories/saveDawProjectFileDialog';
import { writeDawProjectFile } from '../repositories/writeDawProjectFile';

type SaveDawProjectNativeFileInput = {
    bytes: Uint8Array;
    suggestedName: string;
};

type SaveDawProjectNativeFileOutput = Promise<'saved' | 'cancelled'>;

export async function saveDawProjectNativeFile({
    bytes,
    suggestedName,
}: SaveDawProjectNativeFileInput): SaveDawProjectNativeFileOutput {
    const filePath = await saveDawProjectFileDialog({ suggestedName });
    if (!filePath) {
        return 'cancelled';
    }
    await writeDawProjectFile({ filePath, bytes });
    return 'saved';
}

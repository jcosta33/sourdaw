import { pickFiles } from '#/modules/Project/useCases';

import { importDawProject } from './importDawProject';

export async function pickAndImportDawProject(): Promise<boolean> {
    const files = await pickFiles({
        multiple: false,
        filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
    });
    if (!files || files.length === 0) {
        return false;
    }
    const file = files[0]!;
    const buffer = await file.arrayBuffer();
    return importDawProject({ buffer, fileName: file.name });
}

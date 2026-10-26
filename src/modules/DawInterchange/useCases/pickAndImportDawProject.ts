import { pendingProjectReplacements, pickFiles, saveProjectBeforeReplacement } from '#/modules/Project/useCases';

import { importDawProject } from './importDawProject';

export async function pickAndImportDawProject(): Promise<boolean> {
    const files = await pickFiles({
        multiple: false,
        filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
    });
    if (!files || files.length === 0) {
        return false;
    }
    // Choosing the open project's Recent entry from here on withdraws the import.
    const isStillChosen = pendingProjectReplacements.capture();
    // The import replaces the open project: pre-save it first (audit #568 F2)
    // and refuse a failed save or one that resolved with the project still
    // dirty — a plugin capture rejected before commit keeps that edit
    // uncaptured; both refusal surfaces already notified.
    if (!(await saveProjectBeforeReplacement()) || !isStillChosen()) {
        return false;
    }
    const file = files[0]!;
    const buffer = await file.arrayBuffer();
    return (await importDawProject({ buffer, fileName: file.name, shouldProceed: isStillChosen })).ok;
}

import { notifyUser } from '#/utils/Notification/notifyUser';

import { downloadProjectFile } from '../../../repositories/project/downloadProjectFile';

import { buildProjectData } from './buildProjectData';

export async function exportProjectFile(): Promise<void> {
    const built = await buildProjectData();
    if (!built) {
        return;
    }

    const { data, missingBufferCount } = built;
    if (missingBufferCount > 0) {
        notifyUser(
            `${missingBufferCount} audio file${missingBufferCount > 1 ? 's' : ''} could not be bundled with the export — the project may not play back correctly on another machine.`,
            'warning'
        );
    }

    await downloadProjectFile(data);
    notifyUser('Project exported successfully', 'info');
}

import { notifyUser } from '#/utils/Notification/notifyUser';

import { downloadProjectFile } from '../../../repositories/project/downloadProjectFile';
import { captureExternalPluginStates } from '../saveProject/captureExternalPluginStates';

import { buildProjectData } from './buildProjectData';

export async function exportProjectFile(): Promise<void> {
    // Capture live native plugin state into project truth first, so an export that
    // happens without a prior save still ships the current host chunk rather than a
    // stale or empty one (PH-3; matches saveProject).
    await captureExternalPluginStates();
    // The one sanctioned base64 producer: an explicit, user-initiated export.
    // Every other caller leaves it off — see `BuildProjectDataInput`.
    const built = await buildProjectData({ includeAudioBuffers: true });
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

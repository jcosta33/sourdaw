import { logger } from '#/infra/logger/appLogger';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { downloadProjectFile } from '../../../repositories/project/downloadProjectFile';
import { captureExternalPluginStates } from '../saveProject/captureExternalPluginStates';

import { buildProjectData } from './buildProjectData';
import { buildProjectOriginalMediaArchive } from './projectOriginalMediaArchive';

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

    try {
        const archiveData = await buildProjectOriginalMediaArchive(
            data,
            () => agentProjectRepairStateStore.value === null && captureProjectRevision() === built.snapshotRevision
        );
        const outcome = await downloadProjectFile({
            data: archiveData,
            shouldWrite: () => agentProjectRepairStateStore.value === null,
        });
        if (outcome !== 'written') {
            return;
        }
        if (archiveData.originalMedia.unavailable.length > 0) {
            const count = archiveData.originalMedia.unavailable.length;
            notifyUser(
                `Project exported with ${count} unavailable original audio file${count === 1 ? '' : 's'} — ${missingBufferCount === 0 ? 'playable audio is included, but ' : ''}the original source files cannot be recovered from this export.`,
                'warning'
            );
            return;
        }
    } catch (error) {
        logger.error(new Error('Project export failed', { cause: error }));
        notifyUser('Failed to export project', 'error');
        return;
    }
    notifyUser('Project exported successfully', 'info');
}

import { logger } from '#/infra/logger/appLogger';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { downloadProjectFile } from '../../../repositories/project/downloadProjectFile';
import { captureExternalPluginStates } from '../saveProject/captureExternalPluginStates';

import { buildProjectData } from './buildProjectData';
import { buildProjectOriginalMediaArchive } from './projectOriginalMediaArchive';

/**
 * Capture live native plugin state into project truth first, so an export that
 * happens without a prior save still ships the current host chunk rather than a
 * stale or empty one (PH-3; matches saveProject). False when a loaded plugin's
 * current state may be missing from the file.
 */
async function captureEveryPluginState(): Promise<boolean> {
    try {
        const capture = await captureExternalPluginStates();
        return capture.rejectedPlugins.length === 0;
    } catch (error) {
        logger.warn('[exportProjectFile] Native plugin state capture failed:', error);
        return false;
    }
}

export async function exportProjectFile(): Promise<void> {
    const everyPluginCaptured = await captureEveryPluginState();
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
        if (!everyPluginCaptured) {
            notifyUser(
                'Project exported, but the latest state of one or more plugins could not be read — the file holds their last captured state.',
                'warning'
            );
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
    if (everyPluginCaptured) {
        notifyUser('Project exported successfully', 'info');
    }
}

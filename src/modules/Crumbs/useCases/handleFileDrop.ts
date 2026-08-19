/**
 * Handle file drop events on the crumbs panel.
 * Supports both browser File API and native file paths.
 * Auto-detects sample category and suggests appropriate mode.
 */

import { logger } from '#/infra/logger/appLogger';

import { getDroppedCrumbsFilePath } from '../repositories/get-dropped-crumbs-file-path';
import { isCrumbsNativeAvailable } from '../repositories/is-crumbs-native-available';
import { crumbsStore } from '../stores/crumbsStore';

import { loadSampleFromPath } from './loadSample';
import { switchCrumbsMode } from './setCrumbsMode';

import type { SampleCategory, CrumbsMode } from '../models/CrumbsTypes';

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.aac', '.aiff', '.aif', '.m4a']);

function isAudioFile(name: string): boolean {
    const lower = name.toLowerCase();
    return Array.from(AUDIO_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

function categoryToMode(category: SampleCategory): CrumbsMode {
    switch (category) {
        case 'percussive':
            return 'drum';
        case 'loop':
            return 'slice';
        case 'tonal':
            return 'quick';
        case 'unknown':
        default:
            return 'quick';
    }
}

export async function handleCrumbsFileDrop(instanceId: string, event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
        return;
    }

    const file = files[0];
    if (!file || !isAudioFile(file.name)) {
        return;
    }

    if (!isCrumbsNativeAvailable()) {
        logger.warn(
            '[Crumbs] File drop is only supported in the desktop app. Use the sample browser to load audio on web.'
        );
        return;
    }

    const filePath = await getDroppedCrumbsFilePath({ file });

    if (filePath) {
        await loadSampleFromPath(instanceId, filePath);

        const state = crumbsStore.value?.[instanceId];
        if (state?.activeSample) {
            const suggestedMode = categoryToMode(state.activeSample.category);
            await switchCrumbsMode(instanceId, suggestedMode);
        }
    }
}

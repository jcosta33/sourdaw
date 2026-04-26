/**
 * Handle file drop events on the crumbs panel.
 * Supports both browser File API and Tauri file paths.
 * Auto-detects sample category and suggests appropriate mode.
 */

import { logger } from '#/infra/logger/appLogger';
import { isTauri } from '#/utils/tauriBridge';

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

    if (!isTauri()) {
        logger.warn(
            '[Crumbs] File drop is only supported in the desktop app. Use the sample browser to load audio on web.'
        );
        return;
    }

    let filePath: string | null = null;

    if ('path' in file) {
        filePath = (file as File & { path: string }).path;
    }

    if (!filePath) {
        filePath = file.webkitRelativePath || file.name;
    }

    if (filePath) {
        await loadSampleFromPath(instanceId, filePath);

        const state = crumbsStore.value?.[instanceId];
        if (state?.activeSample) {
            const suggestedMode = categoryToMode(state.activeSample.category);
            await switchCrumbsMode(instanceId, suggestedMode);
        }
    }
}

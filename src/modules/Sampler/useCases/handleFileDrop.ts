/**
 * Handle file drop events on the sampler panel.
 * Supports both browser File API and Tauri file paths.
 * Auto-detects sample category and suggests appropriate mode.
 */

import type { DragEvent } from 'react';
import { isTauri } from '#/helpers/tauriBridge';
import type { SampleCategory, SamplerMode } from '../models/SamplerTypes';
import { loadSampleFromPath } from './loadSample';
import { switchSamplerMode } from './setSamplerMode';
import { samplerStore } from '../stores/samplerStore';

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.aac', '.aiff', '.aif', '.m4a']);

function isAudioFile(name: string): boolean {
    const lower = name.toLowerCase();
    return Array.from(AUDIO_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

function categoryToMode(category: SampleCategory): SamplerMode {
    switch (category) {
        case 'percussive':
            return 'drum';
        case 'loop':
            return 'slice';
        case 'tonal':
            return 'quick';
        default:
            return 'quick';
    }
}

export const handleSamplerFileDropDependencies = {
    isTauri,
    loadSampleFromPath,
    switchSamplerMode,
    samplerStore,
} as const;

export async function handleSamplerFileDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer.files;
    if (files.length === 0) {
        return;
    }

    const file = files[0];
    if (!file || !isAudioFile(file.name)) {
        return;
    }

    if (isTauri()) {
        let filePath: string | null = null;

        if ('path' in file) {
            filePath = (file as File & { path: string }).path;
        }

        if (!filePath) {
            filePath = file.webkitRelativePath || file.name;
        }

        if (filePath) {
            await loadSampleFromPath(filePath);

            const state = samplerStore.value;
            if (state?.activeSample) {
                const suggestedMode = categoryToMode(state.activeSample.category);
                await switchSamplerMode(suggestedMode);
            }
        }
    }
}

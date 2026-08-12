import { detectTempo } from '#/modules/AudioAnalysis/useCases';
import { decodeAudioFile, releasePreviewAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { pickFiles } from '#/modules/Project/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { type StemImportRole } from '#/utils/handlerContract';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

const EXACT_PROMPT =
    'import stems align them to project tempo name and group them classify likely instrument roles and create a sensible starting mix';

const STEM_ROLES = [
    'kick',
    'snare',
    'hi-hat',
    'tom',
    'percussion',
    'bass',
    'guitar-left',
    'guitar-right',
    'keys',
    'synth',
    'lead-vocal',
    'backing-vocal',
    'fx',
    'other',
] as const;

function normalize(value: string): string {
    return value.toLocaleLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export async function prepareStemImport(prompt: string) {
    if (normalize(prompt) !== EXACT_PROMPT) {
        return null;
    }

    const files = await pickFiles({
        multiple: true,
        filters: [{ name: 'Audio stems', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] }],
    });
    if (!files) {
        return { status: 'cancelled' as const };
    }
    if (files.length < 2 || files.length > 32) {
        throw new Error('Select between 2 and 32 audio stems.');
    }
    if (new Set(files.map((file) => normalize(file.name))).size !== files.length) {
        throw new Error('Selected stem filenames must be unique.');
    }

    const projectTempo = transportStore.value?.tempo ?? 120;
    if (!Number.isFinite(projectTempo) || projectTempo < 20 || projectTempo > 999) {
        throw new Error('The current project tempo is unavailable for stem alignment.');
    }

    const prepared: Array<{
        stemId: string;
        sourceName: string;
        sourceTempo: number;
        durationSeconds: number;
        audioBufferId: string;
        assetHash?: string;
        stagedAssetOwned?: boolean;
    }> = [];
    try {
        for (const file of files) {
            const decoded = await decodeAudioFile(file);
            const sourceTempo = detectTempo(decoded.id);
            if (sourceTempo === null || !Number.isFinite(sourceTempo) || sourceTempo < 20 || sourceTempo > 999) {
                releasePreviewAudioBuffer(decoded.id);
                throw new Error(`Could not determine a safe source tempo for "${file.name}".`);
            }
            const pendingStem = {
                stemId: `stem-${crypto.randomUUID()}`,
                sourceName: file.name,
                sourceTempo,
                durationSeconds: decoded.buffer.duration,
                audioBufferId: decoded.id,
            };
            prepared.push(pendingStem);
            const stagedAsset = await getAssetTransfer()?.stageLocalAsset(file, file.name);
            if (stagedAsset) {
                Object.assign(pendingStem, {
                    assetHash: stagedAsset.hash,
                    stagedAssetOwned: stagedAsset.owned,
                });
            }
        }
    } catch (error) {
        discardPreparedStemImportResources(prepared);
        throw error;
    }

    return {
        status: 'prepared' as const,
        selectionId: `stem-selection-${crypto.randomUUID()}`,
        projectTempo,
        stems: prepared,
        allowedRoles: [...STEM_ROLES] as StemImportRole[],
    };
}

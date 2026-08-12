import { type StemImportRole } from '#/utils/handlerContract';

import { type StemImportPromptScope } from '../../models/StemImportCapability';

import { getStemImportMix } from './getStemImportMix';

type PreparedStemImport = {
    selectionId: string;
    projectTempo: number;
    allowedRoles: StemImportRole[];
    stems: Array<{
        stemId: string;
        sourceName: string;
        sourceTempo: number;
        durationSeconds: number;
        audioBufferId: string;
        assetHash?: string;
        stagedAssetOwned?: boolean;
    }>;
};

function stripExtension(sourceName: string): string {
    const lastDot = sourceName.lastIndexOf('.');
    return lastDot > 0 ? sourceName.slice(0, lastDot) : sourceName;
}

function displayName(sourceName: string, sourceTempo: number): string {
    const withoutExtension = stripExtension(sourceName);
    const tempoSuffix = /(?:[_\s-]+(?<tempo>\d{2,3}(?:\.\d+)?))$/u.exec(withoutExtension);
    const suffixTempo = Number(tempoSuffix?.groups?.tempo);
    const withoutTempoSuffix =
        tempoSuffix && Number.isFinite(suffixTempo) && Math.abs(suffixTempo - sourceTempo) < 0.01
            ? withoutExtension.slice(0, tempoSuffix.index)
            : withoutExtension;
    const words = withoutTempoSuffix.replaceAll(/[_-]+/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
    return words || 'Imported Stem';
}

export function createStemImportPromptScope(
    prepared: PreparedStemImport,
    projectRevision: string
): StemImportPromptScope {
    const displayNameCounts = new Map<string, number>();
    const trackNames = prepared.stems.map((stem) => {
        const baseName = displayName(stem.sourceName, stem.sourceTempo);
        const nextCount = (displayNameCounts.get(baseName) ?? 0) + 1;
        displayNameCounts.set(baseName, nextCount);
        return nextCount === 1 ? baseName : `${baseName} (${String(nextCount)})`;
    });
    return {
        capability: {
            schemaVersion: 1,
            baseRevision: projectRevision,
            actionType: 'importStemSet',
            selectionId: prepared.selectionId,
            projectTempo: prepared.projectTempo,
            stems: prepared.stems.map((stem) => ({
                stemId: stem.stemId,
                sourceName: stem.sourceName,
                durationSeconds: stem.durationSeconds,
                detectedTempo: stem.sourceTempo,
            })),
            allowedRoles: prepared.allowedRoles,
            constraints: {
                requireCompleteSelection: true,
                preserveExistingProject: true,
                requireFreshConfirmation: true,
                providerCannotAssignProjectIds: true,
            },
        },
        actionSeed: {
            selectionId: prepared.selectionId,
            groupName: 'Imported Stems',
            projectTempo: prepared.projectTempo,
            folderId: `folder-ai-${crypto.randomUUID()}`,
            folderColor: '#708090',
            folderAlternativeId: `alt-ai-${crypto.randomUUID()}`,
            stems: prepared.stems.map((stem, index) => ({
                ...stem,
                role: 'other',
                trackId: `track-ai-${crypto.randomUUID()}`,
                trackName: trackNames[index] ?? 'Imported Stem',
                trackGain: getStemImportMix('other').gain,
                trackPan: getStemImportMix('other').pan,
                trackColor: '#5b8def',
                trackAlternativeId: `alt-ai-${crypto.randomUUID()}`,
                clipId: `clip-ai-${crypto.randomUUID()}`,
            })),
        },
    };
}

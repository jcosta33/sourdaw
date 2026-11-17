import { type Track, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { readRelinkAudioSourceEligibility, relinkClipAudioSource } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { DOC_PREFIX_ROOT, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { AUDIO_EXTENSION_ROSTER, AUDIO_EXTENSIONS, isAudioFile } from '#/utils/audioFileExtensions';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { captureArrangementMediaAuthority } from './captureArrangementMediaAuthority';
import { pickFiles } from './fileDialog';
import { collectMissingMedia } from './projectPersistence/helpers/collectMissingMedia';
import { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';

const AUDIO_FILTER = { name: 'Audio files', extensions: [...AUDIO_EXTENSION_ROSTER] };

type MissingSource = {
    sourceBufferId: string;
    label: string;
};

type SameFolderCandidate = MissingSource & { names: Set<string> };

function comparableSourceName(name: string): string {
    const normalized = name.trim().toLowerCase();
    const extensionStart = normalized.lastIndexOf('.');
    const extension = normalized.slice(extensionStart + 1);
    if (extensionStart <= 0 || !AUDIO_EXTENSIONS.has(extension)) {
        return normalized;
    }
    return normalized.slice(0, extensionStart);
}

async function pickReplacements(multiple: boolean, isCurrent: () => boolean): Promise<File[] | null> {
    try {
        return await pickFiles({ filters: [AUDIO_FILTER], multiple });
    } catch {
        if (isCurrent()) {
            notifyUser('The audio file picker could not be opened. No missing media was changed.', 'error');
        }
        return null;
    }
}

async function relinkReplacement(
    source: MissingSource,
    file: File,
    isCurrent: () => boolean,
    selectionMatches?: (tracks: readonly Track[]) => boolean
): Promise<boolean> {
    if (!isAudioFile(file.name)) {
        notifyUser(`"${file.name}" is not a supported audio file. The missing source was left unchanged.`, 'error');
        return false;
    }

    let replacementBufferId: string;
    try {
        replacementBufferId = (await decodeAudioFile(file)).id;
    } catch {
        if (isCurrent()) {
            notifyUser(`"${file.name}" could not be decoded. The missing source was left unchanged.`, 'error');
        }
        return false;
    }
    if (!isCurrent() || selectionMatches?.(trackStore.value?.tracks ?? []) === false) {
        discardDecodedAudioFile(replacementBufferId);
        return false;
    }

    let result: Awaited<ReturnType<typeof relinkClipAudioSource>>;
    try {
        result = await relinkClipAudioSource({
            sourceBufferId: source.sourceBufferId,
            replacementBufferId,
            shouldExecute: () =>
                isCurrent() &&
                // The optimistic projection already shows the replacement when the commit guard runs.
                selectionMatches?.(sanitizeTrackSnapshot(getCrdtDoc(DOC_PREFIX_ROOT)?.tracks).tracks) !== false,
        });
    } catch (error) {
        discardDecodedAudioFile(replacementBufferId);
        throw error;
    }
    if (result.status === 'relinked') {
        return true;
    }

    discardDecodedAudioFile(replacementBufferId);
    if (!isCurrent() || selectionMatches?.(trackStore.value?.tracks ?? []) === false) {
        return false;
    }
    notifyUser(
        `"${file.name}" could not relink "${source.label}". The source may already have been repaired.`,
        'error'
    );
    return false;
}

function remainingSources(excludedBufferId: string, tracks: readonly Track[]): SameFolderCandidate[] {
    const sources = new Map<string, SameFolderCandidate>();
    for (const item of collectMissingMedia(tracks, (bufferId) => audioBufferCache.has(bufferId))) {
        if (item.kind !== 'clip' || item.bufferId === excludedBufferId) {
            continue;
        }
        const name = comparableSourceName(item.label);
        const source = sources.get(item.bufferId);
        if (source) {
            source.names.add(name);
            continue;
        }
        sources.set(item.bufferId, { sourceBufferId: item.bufferId, label: item.label, names: new Set([name]) });
    }
    return [...sources.values()];
}

function matchSameFolderFile(
    candidates: readonly SameFolderCandidate[],
    file: File,
    selectedNameCounts: ReadonlyMap<string, number>
): SameFolderCandidate | undefined {
    const matchingName = comparableSourceName(file.name);
    const matches = candidates.filter((candidate) => candidate.names.has(matchingName));
    const [source] = matches;
    if (!source || matches.length > 1) {
        return undefined;
    }
    let selectedFileCount = 0;
    for (const name of source.names) {
        selectedFileCount += selectedNameCounts.get(name) ?? 0;
    }
    return selectedFileCount === 1 ? source : undefined;
}

function eligibleForRelink(source: MissingSource): boolean {
    return readRelinkAudioSourceEligibility(source.sourceBufferId) === 'eligible';
}

async function recoverSameFolderSelections(
    candidates: readonly SameFolderCandidate[],
    files: readonly File[],
    excludedBufferId: string,
    isCurrent: () => boolean
): Promise<void> {
    const selectedNameCounts = new Map<string, number>();
    for (const file of files) {
        const name = comparableSourceName(file.name);
        selectedNameCounts.set(name, (selectedNameCounts.get(name) ?? 0) + 1);
    }

    let skippedCount = 0;
    let repaired = false;
    for (const file of files) {
        if (!isCurrent()) {
            return;
        }
        const source = matchSameFolderFile(candidates, file, selectedNameCounts);
        if (!source || !eligibleForRelink(source)) {
            skippedCount++;
            continue;
        }
        const sourceBufferId = source.sourceBufferId;
        function selectionMatches(tracks: readonly Track[]): boolean {
            const match = matchSameFolderFile(remainingSources(excludedBufferId, tracks), file, selectedNameCounts);
            return match?.sourceBufferId === sourceBufferId;
        }
        if (!selectionMatches(trackStore.value?.tracks ?? [])) {
            skippedCount++;
            continue;
        }
        if (await relinkReplacement(source, file, isCurrent, selectionMatches)) {
            repaired = true;
        } else if (isCurrent() && !selectionMatches(trackStore.value?.tracks ?? [])) {
            skippedCount++;
        }
        if (!isCurrent()) {
            return;
        }
    }
    if (repaired) {
        verifyAudioBufferReferences();
    }
    if (skippedCount > 0) {
        notifyUser(
            `${String(skippedCount)} selected ${skippedCount === 1 ? 'file did' : 'files did'} not uniquely match a missing clip name and ${skippedCount === 1 ? 'was' : 'were'} left unchanged.`,
            'warning'
        );
    }
}

async function offerSameFolderRecovery(excludedBufferId: string, isCurrent: () => boolean): Promise<void> {
    if (!isCurrent() || !remainingSources(excludedBufferId, trackStore.value?.tracks ?? []).some(eligibleForRelink)) {
        return;
    }
    const chooseMore = await confirmUser({
        title: 'Resolve other missing files?',
        message:
            'Choose replacements from the same folder. Files are matched to unambiguous missing clip names; unrelated sources are left unchanged.',
        confirmLabel: 'Choose Files',
        cancelLabel: 'Not Now',
        variant: 'default',
    });
    if (!chooseMore || !isCurrent()) {
        return;
    }
    const candidates = remainingSources(excludedBufferId, trackStore.value?.tracks ?? []);
    if (!candidates.some(eligibleForRelink)) {
        return;
    }
    const files = await pickReplacements(true, isCurrent);
    if (files && isCurrent()) {
        await recoverSameFolderSelections(candidates, files, excludedBufferId, isCurrent);
    }
}

/** Locate one replacement through the platform picker and repair every reference to its missing source. */
export async function locateMissingMedia(source: MissingSource): Promise<void> {
    const authority = captureArrangementMediaAuthority();
    const isCurrent = authority.isCurrent;
    try {
        const eligibility = readRelinkAudioSourceEligibility(source.sourceBufferId);
        if (eligibility !== 'eligible') {
            if (eligibility === 'frozen') {
                notifyUser('Unfreeze every track using this source before locating a replacement file.', 'warning');
            } else if (eligibility === 'blocked') {
                notifyUser('Make every clip owner editable before locating a replacement file.', 'warning');
            }
            return;
        }
        const files = await pickReplacements(false, isCurrent);
        const file = files?.[0];
        if (!file || !isCurrent()) {
            return;
        }
        if (!(await relinkReplacement(source, file, isCurrent)) || !isCurrent()) {
            return;
        }

        verifyAudioBufferReferences();
        await offerSameFolderRecovery(source.sourceBufferId, isCurrent);
    } finally {
        authority.dispose();
    }
}

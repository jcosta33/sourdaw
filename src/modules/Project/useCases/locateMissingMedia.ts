import { relinkClipAudioSource } from '#/modules/Arrangement/useCases';
import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { AUDIO_EXTENSION_ROSTER, AUDIO_EXTENSIONS, isAudioFile } from '#/utils/audioFileExtensions';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { missingMediaStore } from '../stores/missingMediaStore';

import { captureArrangementMediaAuthority } from './captureArrangementMediaAuthority';
import { pickFiles } from './fileDialog';
import { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';

const AUDIO_FILTER = { name: 'Audio files', extensions: [...AUDIO_EXTENSION_ROSTER] };

type MissingSource = {
    sourceBufferId: string;
    label: string;
};

function comparableSourceName(name: string): string {
    const normalized = name.trim().toLowerCase();
    const extensionStart = normalized.lastIndexOf('.');
    const extension = normalized.slice(extensionStart + 1);
    if (extensionStart <= 0 || !AUDIO_EXTENSIONS.has(extension)) {
        return normalized;
    }
    return normalized.slice(0, extensionStart);
}

async function pickReplacements(multiple: boolean): Promise<File[] | null> {
    try {
        return await pickFiles({ filters: [AUDIO_FILTER], multiple });
    } catch {
        notifyUser('The audio file picker could not be opened. No missing media was changed.', 'error');
        return null;
    }
}

async function relinkReplacement(source: MissingSource, file: File, isCurrent: () => boolean): Promise<boolean> {
    if (!isAudioFile(file.name)) {
        notifyUser(`"${file.name}" is not a supported audio file. The missing source was left unchanged.`, 'error');
        return false;
    }

    let replacementBufferId: string;
    try {
        replacementBufferId = (await decodeAudioFile(file)).id;
    } catch {
        notifyUser(`"${file.name}" could not be decoded. The missing source was left unchanged.`, 'error');
        return false;
    }
    if (!isCurrent()) {
        discardDecodedAudioFile(replacementBufferId);
        return false;
    }

    let result: Awaited<ReturnType<typeof relinkClipAudioSource>>;
    try {
        result = await relinkClipAudioSource({
            sourceBufferId: source.sourceBufferId,
            replacementBufferId,
            shouldExecute: isCurrent,
        });
    } catch (error) {
        discardDecodedAudioFile(replacementBufferId);
        throw error;
    }
    if (result.status === 'relinked') {
        return true;
    }

    discardDecodedAudioFile(replacementBufferId);
    notifyUser(
        `"${file.name}" could not relink "${source.label}". The source may already have been repaired.`,
        'error'
    );
    return false;
}

function remainingSources(excludedBufferId: string): MissingSource[] {
    const sources = new Map<string, MissingSource>();
    for (const item of missingMediaStore.value?.items ?? []) {
        if (item.kind !== 'clip' || item.bufferId === excludedBufferId || sources.has(item.bufferId)) {
            continue;
        }
        sources.set(item.bufferId, { sourceBufferId: item.bufferId, label: item.label });
    }
    return [...sources.values()];
}

async function offerSameFolderRecovery(excludedBufferId: string, isCurrent: () => boolean): Promise<void> {
    const candidates = remainingSources(excludedBufferId);
    if (candidates.length === 0 || !isCurrent()) {
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

    const files = await pickReplacements(true);
    if (!files || !isCurrent()) {
        return;
    }
    const selectedNameCounts = new Map<string, number>();
    for (const file of files) {
        const name = comparableSourceName(file.name);
        selectedNameCounts.set(name, (selectedNameCounts.get(name) ?? 0) + 1);
    }

    const matchedBufferIds = new Set<string>();
    let skippedCount = 0;
    let repaired = false;
    for (const file of files) {
        if (!isCurrent()) {
            return;
        }
        const name = comparableSourceName(file.name);
        const matches = candidates.filter(
            (candidate) =>
                !matchedBufferIds.has(candidate.sourceBufferId) && comparableSourceName(candidate.label) === name
        );
        if (matches.length !== 1 || selectedNameCounts.get(name) !== 1) {
            skippedCount++;
            continue;
        }
        const source = matches[0]!;
        if (await relinkReplacement(source, file, isCurrent)) {
            matchedBufferIds.add(source.sourceBufferId);
            repaired = true;
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

/** Locate one replacement through the platform picker and repair every reference to its missing source. */
export async function locateMissingMedia(source: MissingSource): Promise<void> {
    const authority = captureArrangementMediaAuthority();
    const isCurrent = authority.isCurrent;
    try {
        const files = await pickReplacements(false);
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

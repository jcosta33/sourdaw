import { relinkClipAudioSource } from '#/modules/Arrangement/useCases';
import { decodeAudioFile, discardDecodedAudioFile } from '#/modules/AudioEngine/useCases';
import { AUDIO_EXTENSION_ROSTER, isAudioFile } from '#/utils/audioFileExtensions';
import { confirmUser } from '#/utils/Notification/confirmUser';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { missingMediaStore } from '../stores/missingMediaStore';

import { pickFiles } from './fileDialog';
import { captureProjectTransitionAuthority } from './projectPersistence/captureProjectTransitionAuthority';
import { verifyAudioBufferReferences } from './projectPersistence/helpers/verifyAudioBufferReferences';

const AUDIO_FILTER = { name: 'Audio files', extensions: [...AUDIO_EXTENSION_ROSTER] };

type MissingSource = {
    sourceBufferId: string;
    label: string;
};

function comparableSourceName(name: string): string {
    const normalized = name.trim().toLowerCase();
    const extensionStart = normalized.lastIndexOf('.');
    return extensionStart > 0 ? normalized.slice(0, extensionStart) : normalized;
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

    const result = relinkClipAudioSource({
        sourceBufferId: source.sourceBufferId,
        replacementBufferId,
    });
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
    if (!files) {
        return;
    }
    const matchedBufferIds = new Set<string>();
    let skippedCount = 0;
    let repaired = false;
    for (const file of files) {
        const matches = candidates.filter(
            (candidate) =>
                !matchedBufferIds.has(candidate.sourceBufferId) &&
                comparableSourceName(candidate.label) === comparableSourceName(file.name)
        );
        if (matches.length !== 1) {
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
    const authority = captureProjectTransitionAuthority();
    const files = await pickReplacements(false);
    const file = files?.[0];
    if (!file) {
        return;
    }
    if (!(await relinkReplacement(source, file, authority.isCurrent)) || !authority.isCurrent()) {
        return;
    }

    verifyAudioBufferReferences();
    await offerSameFolderRecovery(source.sourceBufferId, authority.isCurrent);
}

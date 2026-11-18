import { getExecutableAppActionEffect } from '#/modules/Command/useCases';

import { type CommittedCommand } from '../../models/CommittedBatch';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ThreadContext } from '../../models/ThreadContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { readCommittedBatch } from '../lastCommitContinuation/readCommittedBatch';
import { readChatThreadContext } from '../readChatThreadContext';

import { protectionCandidates } from './protectionCandidates';
import { protectionSlots, type Range } from './readProtectionSlots';
import { refinementRequestReading } from './refinementRequestReading';

const CONTEXTUAL_TONE_REFERENCE = /^(?:that|the same)\s+(?:tone|sound|timbre)$/iu;

type ToneProtectionInput = {
    prompt: string;
    context: ProjectContext;
    thread: ThreadContext | null | undefined;
    clipId: string;
    trackId: string;
};

function findContextualToneClause(prompt: string, context: ProjectContext): Range | undefined {
    const { complete, maskedText } = scanPromptQuotedText(prompt);
    if (!complete) {
        return undefined;
    }
    const starts = protectionSlots.startRanges(maskedText);
    const ranges = protectionSlots.read(maskedText).flatMap((slot) => {
        if (slot.lead !== 'verb' || slot.otherwise || slot.memberSeparators.length > 0) {
            return [];
        }
        const reference = prompt.slice(slot.start, slot.end).trim().replace(/,$/u, '').trimEnd();
        if (!CONTEXTUAL_TONE_REFERENCE.test(reference)) {
            return [];
        }
        const start = starts.find((range) => range.end === slot.start)?.start;
        const end = slot.completeRange?.end ?? slot.end;
        if (start === undefined || (slot.closer !== null && slot.completeRange === null)) {
            return [];
        }
        const candidates = [
            ...refinementRequestReading.candidates(context),
            ...protectionCandidates.extraCandidates(context),
        ];
        if (refinementRequestReading.references(reference, candidates).length > 0) {
            return [];
        }
        return [{ start, end: start + prompt.slice(start, end).trimEnd().replace(/,$/u, '').trimEnd().length }];
    });
    const range = ranges[0];
    if (ranges.length !== 1 || !range) {
        return undefined;
    }
    const hasIndependentInstruction = refinementRequestReading
        .clauses(prompt, context)
        .some(
            (clause) =>
                (clause.start >= range.end || clause.end <= range.start) &&
                protectionSlots.startsInstruction(clause.masked)
        );
    return hasIndependentInstruction ? range : undefined;
}

function matchesCommittedParameter(command: CommittedCommand, trackId: string): boolean {
    const { type, payload } = command;
    const { deviceId, expectedTrackId, paramId, value } = payload;
    return !(
        type !== 'setDeviceParameter' ||
        expectedTrackId !== trackId ||
        typeof deviceId !== 'string' ||
        typeof paramId !== 'string' ||
        typeof value !== 'number'
    );
}

function isProcessingOnly(type: CommittedCommand['type']): boolean {
    const effect = getExecutableAppActionEffect(type);
    return effect?.dimensions.length === 1 && effect.dimensions[0] === 'processing';
}

function hasCommittedParameterOnOwner(command: CommittedCommand, { context, trackId }: ToneProtectionInput): boolean {
    if (!matchesCommittedParameter(command, trackId)) {
        return false;
    }
    const { type, payload } = command;
    const { deviceId, paramId, value } = payload;
    const processingOnly = isProcessingOnly(type);
    const targets = context.tracks.flatMap((track) =>
        track.devices.filter((device) => device.id === deviceId).map((device) => ({ track, device }))
    );
    const target = targets[0];
    if (!processingOnly || targets.length !== 1) {
        return false;
    }
    const param = target?.device.parameters?.find((parameter) => parameter.id === paramId);
    return target?.track.id === trackId && param?.valuePresent !== false && param?.value === value;
}

function isSameStandingCommit(
    prior: NonNullable<ThreadContext['lastCommit']>,
    liveThread: ThreadContext | null
): boolean {
    const current = liveThread?.lastCommit;
    return (
        liveThread?.pendingProposal === null &&
        current?.standing === 'standing' &&
        current.runId === prior.runId &&
        current.receiptIds.length === 1 &&
        current.receiptIds[0] === prior.receiptIds[0]
    );
}

function hasStandingMidiResult(input: ToneProtectionInput): boolean {
    const { thread, clipId } = input;
    const prior = thread?.lastCommit;
    if (thread?.pendingProposal !== null || prior?.standing !== 'standing' || prior.receiptIds.length !== 1) {
        return false;
    }
    const liveThread = readChatThreadContext();
    const current = liveThread?.lastCommit;
    if (!isSameStandingCommit(prior, liveThread) || current === null || current === undefined) {
        return false;
    }
    const batch = readCommittedBatch(current);
    return (
        batch?.commands.every(
            (command) =>
                (command.type === 'editMidiNotes' && command.payload.clipId === clipId) ||
                hasCommittedParameterOnOwner(command, input)
        ) === true
    );
}

/**
 * The caller has already proved a single-clip MIDI-only write. A contextual tone hold constrains
 * its processing, which this command cannot write. Leave every other span to clip protection.
 */
export function readMidiToneProtectionPrompt(input: ToneProtectionInput): string | undefined {
    const { prompt, context } = input;
    if (!hasStandingMidiResult(input)) {
        return undefined;
    }
    const range = findContextualToneClause(prompt, context);
    if (!range) {
        return undefined;
    }
    return `${prompt.slice(0, range.start)}${' '.repeat(range.end - range.start)}${prompt.slice(range.end)}`;
}

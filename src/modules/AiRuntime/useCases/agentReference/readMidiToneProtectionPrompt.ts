import { type ProjectContext } from '../../models/ProjectContext';
import { type ThreadContext } from '../../models/ThreadContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { readChatThreadContext } from '../readChatThreadContext';

import { protectionCandidates } from './protectionCandidates';
import { protectionSlots, type Range } from './readProtectionSlots';
import { refinementRequestReading } from './refinementRequestReading';

const CONTEXTUAL_TONE_REFERENCE = /^(?:that|the same)\s+(?:tone|sound|timbre)$/iu;

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

function hasStandingMidiResult(thread: ThreadContext | null | undefined, clipId: string): boolean {
    const prior = thread?.lastCommit;
    if (prior?.standing !== 'standing' || prior.receiptIds.length !== 1) {
        return false;
    }
    const current = readChatThreadContext()?.lastCommit;
    return (
        current?.standing === 'standing' &&
        current.runId === prior.runId &&
        current.receiptIds.length === 1 &&
        current.receiptIds[0] === prior.receiptIds[0] &&
        current.commands.some((command) => command.name === 'editMidiNotes' && command.arguments?.clipId === clipId)
    );
}

/**
 * The caller has already proved a single-clip MIDI-only write. A contextual tone hold constrains
 * its processing, which this command cannot write. Leave every other span to clip protection.
 */
export function readMidiToneProtectionPrompt(input: {
    prompt: string;
    context: ProjectContext;
    thread: ThreadContext | null | undefined;
    clipId: string;
}): string | undefined {
    const { prompt, context, thread, clipId } = input;
    if (!hasStandingMidiResult(thread, clipId)) {
        return undefined;
    }
    const range = findContextualToneClause(prompt, context);
    if (!range) {
        return undefined;
    }
    return `${prompt.slice(0, range.start)}${' '.repeat(range.end - range.start)}${prompt.slice(range.end)}`;
}

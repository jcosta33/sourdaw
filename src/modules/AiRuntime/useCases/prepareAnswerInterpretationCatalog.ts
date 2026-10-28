import { digest } from '#/utils/canonicalDigest';

import { type AnswerInterpretationCatalog, type AnswerScopeCandidate } from '../models/AnswerInterpretation';
import { getCreativeSelectionSnapshot } from '../models/CreativeInterpretation';
import { type ProjectContext } from '../models/ProjectContext';

function prepareScopes(context: ProjectContext): AnswerScopeCandidate[] {
    const scopes: AnswerScopeCandidate[] = [
        { candidateId: 'master', kind: 'master', objectIds: ['master'], labels: ['Master output'] },
    ];
    for (const track of context.tracks) {
        if (['audio', 'midi', 'bus'].includes(track.kind)) {
            scopes.push({
                candidateId: `s${String(scopes.length)}`,
                kind: track.kind === 'bus' ? 'buses' : 'tracks',
                objectIds: [track.id],
                labels: [track.name],
            });
        }
        for (const clip of track.clips) {
            scopes.push({
                candidateId: `s${String(scopes.length)}`,
                kind: 'clips',
                objectIds: [clip.id],
                labels: [clip.name],
            });
        }
    }
    for (const track of context.tracks) {
        for (const clipId of track.alternativeClipIds ?? []) {
            if (!scopes.some((scope) => scope.kind === 'clips' && scope.objectIds.includes(clipId))) {
                scopes.push({
                    candidateId: `s${String(scopes.length)}`,
                    kind: 'clips',
                    objectIds: [clipId],
                    labels: [clipId],
                });
            }
        }
    }
    const selected = context.tracks.filter(
        (track) => track.id === context.selectedTrackId && ['audio', 'midi', 'bus'].includes(track.kind)
    );
    if (selected.length > 0) {
        scopes.push({
            candidateId: 'selected-track',
            kind: selected[0]!.kind === 'bus' ? 'buses' : 'tracks',
            objectIds: selected.map((track) => track.id),
            labels: selected.map((track) => track.name),
        });
    }
    const roles = new Set(context.tracks.flatMap((track) => (track.canonicalRole ? [track.canonicalRole.role] : [])));
    for (const role of roles) {
        const tracks = context.tracks.filter(
            (track) => track.canonicalRole?.role === role && ['audio', 'midi'].includes(track.kind)
        );
        if (tracks.length > 0) {
            scopes.push({
                candidateId: `role:${role}`,
                kind: 'tracks',
                objectIds: tracks.map((track) => track.id),
                labels: tracks.map((track) => track.name),
            });
        }
    }
    const tracks = context.tracks.filter((track) => ['audio', 'midi'].includes(track.kind));
    if (tracks.length > 0) {
        scopes.push({
            candidateId: 'all-tracks',
            kind: 'tracks',
            objectIds: tracks.map((track) => track.id),
            labels: tracks.map((track) => track.name),
        });
    }
    return scopes;
}

function prepareRanges(context: ProjectContext): AnswerInterpretationCatalog['ranges'] {
    const ranges = (context.sections ?? [])
        .filter(
            (section) =>
                Number.isFinite(section.startBeat) &&
                Number.isFinite(section.endBeat) &&
                section.startBeat >= 0 &&
                section.endBeat > section.startBeat
        )
        .map((section, index) => ({
            candidateId: `r${String(index)}`,
            label: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
            sectionId: section.id,
        }));
    const endBeat = Math.max(
        0,
        ...context.tracks.flatMap((track) => track.clips.map((clip) => clip.endBeat)).filter(Number.isFinite)
    );
    if (endBeat > 0) {
        ranges.push({ candidateId: 'arrangement', label: 'Arrangement', startBeat: 0, endBeat, sectionId: null });
    }
    return ranges;
}

/** Candidates are taken before provider context caps; no invented arrangement extent. */
export function prepareAnswerInterpretationCatalog(input: {
    prompt: string;
    context: ProjectContext;
    projectRevision: string;
}): AnswerInterpretationCatalog {
    const context = structuredClone(input.context);
    return {
        schemaVersion: 1,
        catalogId: `answer-${crypto.randomUUID()}`,
        requestDigest: digest(input.prompt),
        revision: input.projectRevision,
        selection: getCreativeSelectionSnapshot(context),
        scopes: prepareScopes(context),
        ranges: prepareRanges(context),
        context,
    };
}

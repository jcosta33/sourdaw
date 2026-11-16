import { projectDrumPreviewCandidateNotes } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'createDrumPreviewBranches' }>;

export function materializeDrumPreviewBranches(action: Action, state: MaterializationState): MaterializationStep {
    const { options } = state;
    const scope = options.drumPreviewBranchesScope;
    if (!scope || action.payload.sectionId !== scope.section.id) {
        return { status: 'rejected', reason: 'EX-05 drum preview branch scope is unavailable' };
    }
    const recipes = ['ghost-note-pocket', 'half-time-space', 'syncopated-hats'] as const;
    const candidates: Extract<AppAction, { type: 'createDrumPreviewBranches' }>['payload']['candidates'][number][] = [];
    for (const [index, recipe] of recipes.entries()) {
        const branchId = crypto.randomUUID();
        const snareNotes = projectDrumPreviewCandidateNotes({
            branchId,
            endBeat: scope.section.endBeat,
            notes: scope.snare.expectedNotes,
            recipe,
            role: 'snare',
            startBeat: scope.section.startBeat,
        });
        const hiHatNotes = projectDrumPreviewCandidateNotes({
            branchId,
            endBeat: scope.section.endBeat,
            notes: scope.hiHat.expectedNotes,
            recipe,
            role: 'hi-hat',
            startBeat: scope.section.startBeat,
        });
        if (!snareNotes || !hiHatNotes) {
            return { status: 'rejected', reason: 'EX-05 drum candidate projection is unavailable' };
        }
        const names = ['Ghost-note Pocket', 'Half-time Space', 'Syncopated Hats'] as const;
        candidates.push({
            branchId,
            branchName: `Drum Candidate ${String(index + 1)} — ${names[index]!}`,
            rootDocId: `branch_${branchId}`,
            recipe,
            snareNotes: structuredClone(snareNotes),
            hiHatNotes: structuredClone(hiHatNotes),
        });
    }
    return {
        status: 'accepted',
        actions: [
            {
                type: 'createDrumPreviewBranches',
                payload: {
                    ownerId: crypto.randomUUID(),
                    createdAt: Date.now(),
                    expectedSourceBranchId: scope.sourceBranchId,
                    expectedSourceHeads: [...scope.sourceHeads],
                    expectedDocuments: scope.expectedDocuments.map(({ docId, heads }) => ({
                        docId,
                        heads: [...heads],
                    })),
                    expectedBranchState: structuredClone(scope.expectedBranchState),
                    sectionId: scope.section.id,
                    sectionName: scope.section.name,
                    sectionStartBeat: scope.section.startBeat,
                    sectionEndBeat: scope.section.endBeat,
                    candidateCount: 3,
                    varyingRoles: ['snare', 'hi-hat'],
                    kick: structuredClone(scope.kick),
                    snare: structuredClone(scope.snare),
                    hiHat: structuredClone(scope.hiHat),
                    candidates,
                },
            },
        ],
    };
}

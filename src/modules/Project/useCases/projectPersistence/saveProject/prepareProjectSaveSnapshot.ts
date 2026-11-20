import {
    captureAutomergeStoragePreparationScope,
    captureAutomergeStorageTransactionScope,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import {
    captureProjectRevision,
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { type HandlerCommitValidation, type HandlerExecutionResult } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import {
    arrangementStore,
    defaultArrangementStoreState,
    prepareArrangementStoreState,
} from '../../../stores/arrangementStore';
import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import {
    authorizedPreparations,
    ProjectSavePreparationStaleError,
    type SavePreparationIntent,
} from '../../../stores/savePreparationAuthority';
import { takeSnapshot } from '../../arrangement/takeSnapshot';

function snapshotSources(): readonly unknown[] {
    return [
        trackStore.value,
        automationStore.value,
        midiStore.value,
        tempoMapStore.value,
        timeSignatureMapStore.value,
        markerStore.value,
        takeLaneStore.value,
    ];
}

function canonicalValue(value: unknown): unknown {
    const json: unknown = JSON.stringify(value);
    if (typeof json !== 'string') {
        throw new TypeError('Project Save preparation requires serializable state');
    }
    const canonical: unknown = JSON.parse(json);
    return canonical;
}

function captureSaveInputs(readCurrentProject: () => ProjectStoreState) {
    const revision = settlePendingProjectWritesAndCaptureRevision();
    const project = readCurrentProject();
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    const rootMeta = root?.projectMeta;
    if (
        !root ||
        !isRecord(rootMeta) ||
        rootMeta.projectId !== project.projectId ||
        rootMeta.createdAt !== project.createdAt
    ) {
        throw new Error('Project Save preparation requires matching native metadata');
    }

    const arrangements = arrangementStore.value;
    const active = arrangements?.arrangements.find((row) => row.id === arrangements.activeArrangementId);
    if (!arrangements || !active) {
        throw new Error('Project Save preparation requires an active arrangement');
    }

    const initializeLegacyArrangement = root.arrangements === undefined;
    let nextArrangements = defaultArrangementStoreState;
    if (!initializeLegacyArrangement) {
        nextArrangements = {
            ...arrangements,
            arrangements: arrangements.arrangements.map((row) =>
                row === active ? takeSnapshot(row.id, row.name) : row
            ),
        };
    }
    const sources = snapshotSources();
    const updatedAt = Date.now();
    return {
        revision,
        project,
        arrangements,
        sources,
        nextProject: { ...project, updatedAt, dirty: true },
        initializeLegacyArrangement,
        nextArrangements,
        expectedArrangements: canonicalValue(nextArrangements),
        expectedMetadata: { ...rootMeta, updatedAt },
    };
}

function createSaveCommitValidation(
    assertCurrent: () => void,
    inputs: ReturnType<typeof captureSaveInputs>
): HandlerCommitValidation {
    return {
        beforeCommit: () => {
            assertCurrent();
            return null;
        },
        documentId: DOC_PREFIX_ROOT,
        validateDocument: (document) => {
            assertCurrent();
            if (
                valuesEqual(document.arrangements, inputs.expectedArrangements) &&
                valuesEqual(document.projectMeta, inputs.expectedMetadata)
            ) {
                return null;
            }
            return 'Prepared Save arrangement or project metadata changed before publication';
        },
        release: () => undefined,
    };
}

type ArrangementPlan = NonNullable<ReturnType<typeof prepareArrangementStoreState>>;

function planArrangement(
    scope: Parameters<typeof prepareArrangementStoreState>[0],
    inputs: ReturnType<typeof captureSaveInputs>
): ArrangementPlan | undefined {
    if (inputs.initializeLegacyArrangement || valuesEqual(inputs.arrangements, inputs.expectedArrangements)) {
        return undefined;
    }
    const plan = prepareArrangementStoreState(scope, inputs.nextArrangements);
    if (!plan) {
        throw new Error('Bounded native Save preparation is unavailable');
    }
    return plan;
}

async function materializeArrangement(
    plan: ArrangementPlan,
    signal: AbortSignal,
    assertPreparationCurrent: () => void
): Promise<void> {
    plan.clone();
    const request = plan.requestMaterialization;
    if (request) {
        try {
            await request(signal);
        } catch (error) {
            // Reclassify a superseded plan even when Worker admission refuses it first.
            assertPreparationCurrent();
            throw error;
        }
    }
    // Roots with explicit native authors intentionally materialize locally to preserve authorship.
    assertPreparationCurrent();
    plan.materialize();
}

/** Stage only the exact request minted by the owning Save. Replay and reconstructed arguments have no authority. */
export async function prepareProjectSaveSnapshot(
    intent: SavePreparationIntent,
    signal: AbortSignal | undefined
): Promise<HandlerExecutionResult> {
    const request = authorizedPreparations.get(intent);
    authorizedPreparations.delete(intent);
    if (!request || !signal) {
        throw new Error('Project Save preparation requires its owning request');
    }
    const preparationScope = captureAutomergeStoragePreparationScope();
    const scope = captureAutomergeStorageTransactionScope();
    if (!preparationScope) {
        throw new Error('Project Save preparation requires an open action transaction');
    }

    const readCurrentProject = request.readProject;
    const inputs = captureSaveInputs(readCurrentProject);
    let expectedProject = inputs.project;
    let expectedArrangements = inputs.arrangements;

    function assertCurrent(): void {
        if (
            readCurrentProject() !== expectedProject ||
            arrangementStore.value !== expectedArrangements ||
            captureProjectRevision() !== inputs.revision ||
            snapshotSources().some((value, index) => value !== inputs.sources[index])
        ) {
            throw new ProjectSavePreparationStaleError();
        }
    }

    const plan = planArrangement(preparationScope, inputs);
    try {
        if (plan) {
            await materializeArrangement(plan, signal, assertCurrent);
        }
        scope(() => {
            assertCurrent();
            projectStore.set(inputs.nextProject);
            const stagedProject = projectStore.value;
            if (!stagedProject || !valuesEqual(stagedProject, inputs.nextProject)) {
                throw new ProjectSavePreparationStaleError();
            }
            expectedProject = stagedProject;
            if (inputs.initializeLegacyArrangement) {
                // The bounded Worker owns the array. Begin with the small legacy default and let
                // the next Save action prepare the live rows without creating the sibling pointer.
                arrangementStore.set(inputs.nextArrangements);
            } else if (plan && !plan.stage()) {
                throw new ProjectSavePreparationStaleError();
            }
            const stagedArrangements = arrangementStore.value;
            if (!stagedArrangements || !valuesEqual(stagedArrangements, inputs.expectedArrangements)) {
                throw new ProjectSavePreparationStaleError();
            }
            expectedArrangements = stagedArrangements;
            assertCurrent();
        });
        request.initializedLegacyArrangement = inputs.initializeLegacyArrangement;
        return { status: 'written', commitValidation: createSaveCommitValidation(assertCurrent, inputs) };
    } finally {
        plan?.discard();
    }
}

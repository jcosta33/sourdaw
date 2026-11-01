import { getCurrentAutomergeStorageMutationOwner } from '#/infra/store/storage/createAutomergeStorage';
import { captureProjectRootIdentity, getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { valuesEqual } from '#/utils/structuralEquality';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';

import { createClipSplitSourceFrontier } from './createClipSplitSourceFrontier';

type Root = Readonly<Record<string, unknown>>;
type Input = {
    root: Root;
    before: unknown;
    identity: string;
    owner: object;
    read: (document: Root) => unknown;
    projected: () => unknown;
    readOwners: (document: Root) => unknown;
};
type Context = Input & { rawOwnersUnchanged: (document: Root) => boolean };
type State = { observed: unknown; expected?: unknown; certifiedRaw?: Root; intervened: boolean };

function observe(state: State, context: Context): void {
    const current = getCrdtDoc('root');
    const next = context.projected();
    const changed = !valuesEqual(next, state.observed);
    state.intervened ||=
        !current ||
        captureProjectRootIdentity() !== context.identity ||
        !context.rawOwnersUnchanged(current) ||
        (changed && getCurrentAutomergeStorageMutationOwner() !== context.owner);
    if (state.expected !== undefined && changed && !state.intervened) {
        state.expected = next;
    }
    state.observed = next;
}

function certifyRaw(state: State, context: Context, document: Root): boolean {
    const current = getCrdtDoc('root');
    if (
        state.intervened ||
        captureProjectRootIdentity() !== context.identity ||
        current === undefined ||
        !context.rawOwnersUnchanged(current) ||
        current !== document
    ) {
        return false;
    }
    state.certifiedRaw = document;
    return true;
}

function certifiedOwnersUnchanged(state: State, context: Context): boolean {
    const current = getCrdtDoc('root');
    return (
        !state.intervened &&
        captureProjectRootIdentity() === context.identity &&
        current !== undefined &&
        current === state.certifiedRaw &&
        valuesEqual(context.readOwners(current), context.before)
    );
}

function subscribe(observeOwners: () => void): () => void {
    const releases = [
        trackStore.subscribe(observeOwners),
        takeLaneStore.subscribe(observeOwners),
        transportStore.subscribe(observeOwners),
        tempoMapStore.subscribe(observeOwners),
    ];
    return () => {
        for (const unsubscribe of releases.splice(0)) {
            unsubscribe();
        }
    };
}

export function observeClipSplitSource(input: Input) {
    const state: State = { observed: input.projected(), intervened: false };
    const context: Context = {
        ...input,
        rawOwnersUnchanged: createClipSplitSourceFrontier(input.root, input.before, input.readOwners),
    };
    const release = subscribe(() => observe(state, context));
    return {
        recordWrittenState: (value: unknown) => {
            state.expected = value;
            return !state.intervened;
        },
        beforeCommit: () => {
            const current = getCrdtDoc('root');
            return current && certifyRaw(state, context, current)
                ? null
                : 'Split source owners or clock changed before commit';
        },
        beforeMutation: (document: Root) =>
            certifyRaw(state, context, document) ? null : 'Split source owners or clock changed before commit',
        validateDocument: (document: Root) =>
            certifiedOwnersUnchanged(state, context) &&
            state.expected !== undefined &&
            valuesEqual(input.read(document), state.expected)
                ? null
                : 'Split source effect did not reach committed owners',
        release,
    };
}

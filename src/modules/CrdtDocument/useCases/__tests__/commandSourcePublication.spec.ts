import { change, clone, getHeads, hasHeads, merge, view } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { type CommandSourceProof } from '#/utils/handlerContract';
import { digest } from '#/utils/canonicalDigest';

import { setSemanticContext, clearSemanticContext } from '../../stores/semanticChangeContext';
import { commandSourcePublicationMatches, stageCommandSourcePublication } from '../commandSourcePublication';
import { createCrdtDoc } from '../createCrdtDoc';
import { getCrdtDoc } from '../getCrdtDoc';
import { mutateCrdtDoc } from '../mutateCrdtDoc';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../removeCrdtDoc';
import { replaceCrdtDocInLineage } from '../replaceCrdtDocInLineage';

describe('command source publication references', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
    });
    afterEach(() => {
        clearSemanticContext();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    function publish() {
        const value = createAutomergeStorage<{ count: number }>('root', 'source');
        value.hydrate?.();
        const source = { before: value.get()?.count ?? 0 };
        const reference: CommandSourceProof = { changeHash: '', memberId: '' };
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            const install = stageCommandSourcePublication('count', source, reference);
            value.set({ count: source.before + 1 });
            return install;
        });
        if (transaction.status !== 'returned') throw transaction.error;
        transaction.commit();
        transaction.value();
        return { source, reference };
    }

    it('reads the exact source publication after later changes and rejects wrong source/member/change/root', () => {
        const { source, reference } = publish();
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(true);
        mutateCrdtDoc({
            id: 'root',
            changeFn: (draft) => {
                draft.other = true;
            },
        });
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(true);
        expect(commandSourcePublicationMatches('count', { before: 123 }, reference)).toBe(false);
        expect(commandSourcePublicationMatches('other', source, reference)).toBe(false);
        expect(commandSourcePublicationMatches('count', source, { ...reference, memberId: 'other' })).toBe(false);
        expect(
            commandSourcePublicationMatches('count', source, {
                ...reference,
                changeHash: getHeads(getCrdtDoc('root')!)[0],
            })
        ).toBe(false);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(false);
    });

    it('cannot certify a rolled-back receipt or a publication belonging to a replaced project', () => {
        const before = clone(getCrdtDoc('root')!);
        const beforeHeads = getHeads(before);
        const { source, reference } = publish();
        replaceCrdtDocInLineage({ id: 'root', doc: before });
        expect(getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
        expect(getCrdtDoc('root')!.source).toBeUndefined();
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(false);
    });

    it('rejects a future publication retained in the backend of an older current view', () => {
        const before = getHeads(getCrdtDoc('root')!);
        const { source, reference } = publish();
        const historical = view(getCrdtDoc('root')!, before);
        expect(hasHeads(historical, [reference.changeHash])).toBe(true);
        replaceCrdtDocInLineage({ id: 'root', doc: historical });
        expect(getHeads(getCrdtDoc('root')!)).toEqual(before);
        expect(getCrdtDoc('root')!.source).toBeUndefined();
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(false);
    });

    it('does not reuse an earlier outside-frontier set when the shared backend learns another future', () => {
        const first = publish();
        const current = getCrdtDoc('root')!;
        const heads = getHeads(current);
        expect(commandSourcePublicationMatches('count', first.source, first.reference)).toBe(true);
        const second = publish();
        replaceCrdtDocInLineage({ id: 'root', doc: current });
        expect(getHeads(getCrdtDoc('root')!)).toEqual(heads);
        expect(hasHeads(current, [second.reference.changeHash])).toBe(true);
        expect(commandSourcePublicationMatches('count', second.source, second.reference)).toBe(false);
        expect(commandSourcePublicationMatches('count', first.source, first.reference)).toBe(true);
    });

    it('rejects a backend-known source publication outside a concurrent current frontier', () => {
        const before = clone(getCrdtDoc('root')!);
        const { source, reference } = publish();
        const sibling = change(before, (draft) => {
            draft.sibling = true;
        });
        const joined = merge(clone(getCrdtDoc('root')!), sibling);
        const current = view(joined, getHeads(sibling));
        expect(hasHeads(current, [reference.changeHash])).toBe(true);
        replaceCrdtDocInLineage({ id: 'root', doc: current });
        expect(getHeads(getCrdtDoc('root')!)).toEqual(getHeads(sibling));
        expect(getCrdtDoc('root')!.source).toBeUndefined();
        expect(commandSourcePublicationMatches('count', source, reference)).toBe(false);
    });

    it('does not interpret ordinary user message text as source evidence', () => {
        const source = { before: 0 };
        const sourceDigest = digest({ version: 1, kind: 'count', source });
        const reference: CommandSourceProof = { changeHash: '', memberId: sourceDigest };
        setSemanticContext({
            message: JSON.stringify({ version: 1, memberId: sourceDigest, kind: 'count', digest: sourceDigest }),
            actionKind: 'rename',
            entityRefs: [],
        });
        const value = createAutomergeStorage<{ count: number }>('root', 'source');
        const transaction = runWithAutomergeStorageTransaction(undefined, () => value.set({ count: 1 }));
        transaction.commit();
        reference.changeHash = getHeads(getCrdtDoc('root')!)[0]!;
        expect(commandSourcePublicationMatches('count', { before: 0 }, reference)).toBe(false);
    });
});

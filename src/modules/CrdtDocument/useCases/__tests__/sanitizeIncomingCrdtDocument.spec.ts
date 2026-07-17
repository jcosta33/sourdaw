import { change, init, type Doc } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { sanitizeIncomingCrdtDocument } from '../sanitizeIncomingCrdtDocument';

type IncomingDocument = {
    actionHistory?: unknown;
};

describe('sanitizeIncomingCrdtDocument', () => {
    it('should return an already valid document without adding a local change', () => {
        const document = change(init<IncomingDocument>(), (draft) => {
            draft.actionHistory = {
                entries: [
                    {
                        id: 'valid-entry',
                        label: 'Peer action',
                        actionKind: 'setTempo',
                        source: 'manual',
                        timestamp: 1,
                        reverted: false,
                    },
                ],
            };
        });

        expect(sanitizeIncomingCrdtDocument(document)).toBe(document);
    });

    it('should preserve valid display metadata while stripping executable, unknown, and invalid peer rows', () => {
        const document = change(init<IncomingDocument>(), (draft) => {
            draft.actionHistory = {
                entries: [
                    {
                        id: 'valid-entry',
                        label: 'Peer action',
                        actionKind: 'setTempo',
                        source: 'manual',
                        timestamp: 1,
                        reverted: false,
                        action: { type: 'setTempo' },
                        inverseAction: { type: 'setTempo' },
                        unknownField: 'drop me',
                    },
                    { id: 'invalid-entry', action: { type: 'stopPlayback' } },
                ],
            };
        });

        // sanitizeIncomingCrdtDocument returns Doc<unknown>; the input was built as
        // Doc<IncomingDocument>, so re-affirming that shape here is sound.
        const sanitized = sanitizeIncomingCrdtDocument(document) as Doc<IncomingDocument>;

        expect(sanitized.actionHistory).toEqual({
            entries: [
                {
                    id: 'valid-entry',
                    label: 'Peer action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                },
            ],
        });
    });
});

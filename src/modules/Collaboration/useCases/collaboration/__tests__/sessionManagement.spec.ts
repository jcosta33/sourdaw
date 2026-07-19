import { describe, it, expect } from 'vitest';

import { PEER_COLORS } from '../../../models/CollaborationTypes';
import { sessionRuntimePrimitives } from '../sessionManagement';

describe('sessionRuntimePrimitives', () => {
    describe('generatePeerId', () => {
        it('returns a well-formed UUID', () => {
            const id = sessionRuntimePrimitives.generatePeerId();
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        it('returns a distinct value on each call', () => {
            const first = sessionRuntimePrimitives.generatePeerId();
            const second = sessionRuntimePrimitives.generatePeerId();
            expect(first).not.toBe(second);
        });
    });

    describe('generateSessionId', () => {
        it('returns the first 8 hex characters of a UUID', () => {
            const id = sessionRuntimePrimitives.generateSessionId();
            expect(id).toHaveLength(8);
            expect(id).toMatch(/^[0-9a-f]{8}$/i);
        });
    });

    describe('pickPeerColor', () => {
        it('picks the first palette color when nothing is excluded', () => {
            expect(sessionRuntimePrimitives.pickPeerColor([])).toBe(PEER_COLORS[0]);
        });

        it('skips colors already in use', () => {
            const excluded = [PEER_COLORS[0], PEER_COLORS[1]];
            expect(sessionRuntimePrimitives.pickPeerColor(excluded)).toBe(PEER_COLORS[2]);
        });

        it('falls back to an HSL overflow slot once the palette is exhausted', () => {
            const color = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS]);
            expect(color).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
        });

        it('advances past overflow slots that are already taken too', () => {
            const first = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS]);
            const second = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS, first]);
            expect(second).not.toBe(first);
            expect(second).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
        });
    });

    describe('compressInvite / decompressInvite', () => {
        it('round-trips JSON through deflate-raw compression with a "z:" tag', async () => {
            const payload = JSON.stringify({ type: 'offer', peerId: 'p1', sessionId: 's1' });

            const compressed = await sessionRuntimePrimitives.compressInvite(payload);
            expect(compressed.startsWith('z:')).toBe(true);

            const decompressed = await sessionRuntimePrimitives.decompressInvite(compressed);
            expect(decompressed).toBe(payload);
        });

        it('falls back to legacy plain-base64 decoding for uncompressed invites', async () => {
            const payload = JSON.stringify({ type: 'offer', peerId: 'legacy' });
            const legacyInvite = btoa(payload);

            const decompressed = await sessionRuntimePrimitives.decompressInvite(legacyInvite);

            expect(decompressed).toBe(payload);
        });
    });

    describe('state', () => {
        it('starts with no active peer manager or pending invite', () => {
            expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
            expect(sessionRuntimePrimitives.state.pendingInviteId).toBeNull();
            expect(sessionRuntimePrimitives.state.hasBranchStateBackup).toBe(false);
        });
    });
});

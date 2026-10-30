import { change, clone, decodeChange, free, getChanges, getHeads, init, load, save, toJS } from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

import { createWarpMarker, defaultWarpState } from '../WarpMarker';

// F9 protected the full UUID against 32-bit truncation. Recover every byte,
// including late bytes, rather than coupling that protection to hex spelling.
function recoverUuid(id: string): string {
    expect(id).toMatch(/^warp-[A-Za-z0-9_-]{22}$/);
    const encoded = id.slice('warp-'.length);
    expect(encoded.at(-1)).toMatch(/[AQgw]/);
    const binary = atob(`${encoded.replaceAll('-', '+').replaceAll('_', '/')}==`);
    expect(binary).toHaveLength(16);
    const hex = Array.from(binary, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixtureUuid(index: number): ReturnType<typeof crypto.randomUUID> {
    return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

afterEach(() => vi.restoreAllMocks());

describe('createWarpMarker', () => {
    it('creates markers with original and warped beat positions', () => {
        const message = createWarpMarker(0, 0);
        const node = createWarpMarker(4, 4.5);
        expect(message.originalBeat).toBe(0);
        expect(message.warpedBeat).toBe(0);
        expect(node.id).not.toBe(message.id);
        expect(node.id).toMatch(/^warp-[A-Za-z0-9_-]{22}$/);
    });

    it.each([
        '00000000-0000-4000-8000-000000000000',
        'ffffffff-ffff-4fff-bfff-ffffffffffff',
        '12345678-9abc-4def-8123-456789abcdef',
        '12345678-9abc-4def-8123-456789abcdee',
        'fbefbefb-efbe-4bef-befb-efbefbefbefb',
    ] as const)('preserves the complete UUID %s in one canonical encoding', (uuid) => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
        const marker = createWarpMarker(1, 2);
        expect(randomUuid).toHaveBeenCalledTimes(1);
        expect(recoverUuid(marker.id)).toBe(uuid);
    });

    it('keeps UUIDs with identical first eight bytes and different late bytes distinct', () => {
        const randomUuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-9abc-4def-8123-456789abcdef')
            .mockReturnValueOnce('12345678-9abc-4def-8123-456789abcdee');
        const first = createWarpMarker(1, 1);
        const second = createWarpMarker(1, 1);
        expect(first.id).not.toBe(second.id);
        expect(recoverUuid(first.id)).toBe('12345678-9abc-4def-8123-456789abcdef');
        expect(recoverUuid(second.id)).toBe('12345678-9abc-4def-8123-456789abcdee');
        expect(randomUuid).toHaveBeenCalledTimes(2);
    });

    it('removes 1680 native Text operations for 120 markers without changing canonical authority or no-op behavior', () => {
        const uuids = Array.from({ length: 120 }, (_, index) => fixtureUuid(index));
        let nextUuid = 0;
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
            const uuid = uuids[nextUuid++];
            if (!uuid) {
                throw new Error('Unexpected extra marker identity');
            }
            return uuid;
        });
        const markers = uuids.map((_, index) =>
            createWarpMarker(index + 0.25, index + 0.25, { origin: 'transient-auto', confidence: 0.75 })
        );
        const legacyMarkers = markers.map((marker, index) => ({ ...marker, id: `warp-${uuids[index]}` }));
        const actor = 'aaaaaaaaaaaaaaaa';
        const initial = init<Record<string, unknown>>({ actor });
        let legacy = clone(initial, { actor });
        let compact = clone(initial, { actor });
        let checked: typeof compact | undefined;
        let beforeNoop: typeof compact | undefined;
        const mutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'warpStates',
            baseValue: { states: {} },
            value: { states: { clip: { ...defaultWarpState, markers } } },
            documentPresence: { slot: undefined },
        };
        const options = { message: 'Detect transients', time: 7 };
        try {
            legacy = change(legacy, options, (draft) =>
                applyCanonicalStorageSlotMutation(draft, {
                    ...mutation,
                    value: { states: { clip: { ...defaultWarpState, markers: legacyMarkers } } },
                })
            );
            compact = change(compact, options, (draft) => applyCanonicalStorageSlotMutation(draft, mutation));
            const legacyChanges = getChanges(initial, legacy);
            const compactChanges = getChanges(initial, compact);
            expect(legacyChanges).toHaveLength(1);
            expect(compactChanges).toHaveLength(1);
            const legacyBytes = legacyChanges[0];
            const compactBytes = compactChanges[0];
            if (!legacyBytes || !compactBytes) {
                throw new Error('Expected canonical native changes');
            }
            const legacyChange = decodeChange(legacyBytes);
            const compactChange = decodeChange(compactBytes);
            console.info('Warp-marker native operations', {
                legacy: legacyChange.ops.length,
                compact: compactChange.ops.length,
            });
            expect(legacyChange.ops.length - compactChange.ops.length).toBe(1680);
            for (const nativeChange of [legacyChange, compactChange]) {
                expect(nativeChange).toMatchObject({ actor, seq: 1, deps: getHeads(initial), ...options });
                expect(nativeChange.ops.filter((op) => op.action === 'makeText' && op.key === 'id')).toHaveLength(120);
            }
            expect(markers.map((marker) => ({ ...marker, id: recoverUuid(marker.id) }))).toEqual(
                legacyMarkers.map((marker) => ({ ...marker, id: marker.id.slice('warp-'.length) }))
            );
            checked = load(save(compact), { actor });
            expect(toJS(checked)).toEqual({ warpStates: mutation.value });
            expect(getHeads(checked)).toEqual(getHeads(compact));
            beforeNoop = clone(compact, { actor });
            compact = change(compact, options, (draft) => applyCanonicalStorageSlotMutation(draft, mutation));
            expect(getChanges(beforeNoop, compact)).toEqual([]);
            expect(getHeads(compact)).toEqual(getHeads(beforeNoop));
            expect(randomUuid).toHaveBeenCalledTimes(120);
        } finally {
            if (beforeNoop) {
                free(beforeNoop);
            }
            if (checked) {
                free(checked);
            }
            free(compact);
            free(legacy);
            free(initial);
        }
    });
});

describe('defaultWarpState', () => {
    it('disables warping with empty markers and the repitch stretch mode', () => {
        expect(defaultWarpState.enabled).toBe(false);
        expect(defaultWarpState.markers).toEqual([]);
        expect(defaultWarpState.stretchMode).toBe('repitch');
        expect(defaultWarpState.originalTempo).toBeNull();
    });
});

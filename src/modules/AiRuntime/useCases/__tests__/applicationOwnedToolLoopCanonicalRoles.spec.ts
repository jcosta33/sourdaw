import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { createCrdtProject, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { querySemanticProject } from '#/modules/Project/useCases';

import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { buildAgentContext } from '../buildAgentContext';
import { getProjectContext } from '../getProjectContext';

describe('canonical roles at the provider continuation boundary', () => {
    let database: ReturnType<typeof installTransactionalIndexedDb>;
    beforeEach(async () => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        database = installTransactionalIndexedDb();
        await createCrdtProject('Canonical query');
        const track = createTrack({ id: 't', name: 'Track 1', kind: 'midi' });
        track.devices = [
            { id: 'd', type: 'builtin-drum-kit', name: 'Kit', bypassed: true, parameterValues: { kit: 0 } },
        ];
        track.clips = [
            {
                id: 'c',
                trackId: 't',
                name: 'Clip',
                type: 'midi',
                startBeat: 0,
                endBeat: 4,
                muted: true,
                locked: false,
                color: '',
                gain: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
            },
        ];
        setTrackStoreState({ ...structuredClone(defaultTrackState), tracks: [track], selectedTrackId: 't' });
        setMidiStoreState({
            ...structuredClone(defaultMidiStoreState),
            notesByClipId: { c: [{ id: 'n', pitch: 36, startBeat: 0, duration: 1, velocity: 0, probability: 0 }] },
        });
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            projectId: '405e744b-dead-843a-9395-86fdcd66368c',
        });
    });
    afterEach(async () => {
        await database.dispose();
        vi.unstubAllGlobals();
    });

    it.each(['object', 'project-summary'] as const)(
        'carries the actual owner %s receipt into the next provider turn without project mutations',
        async (type) => {
            const before = captureProjectRevision();
            const query: Parameters<typeof querySemanticProject>[0] = { type };
            if (type === 'object') {
                query.filters = { kind: 'track' };
            }
            const ownerReceipt = querySemanticProject(query);
            const context = getProjectContext();
            const providerMessage = buildAgentContext({
                fixedPolicy: 'policy',
                prompt: 'Inspect the track role',
                context,
                projectRevision: before,
            }).message;
            expect(providerMessage).toContain('"canonicalRole":{"role":"kick","source":"clip-content"');
            type Turn = Parameters<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>[0];
            const requestTurn = vi.fn(async (turn: Turn) => {
                if (turn.turn === 1) {
                    return {
                        status: 'complete' as const,
                        toolCalls: [
                            {
                                id: 'role-query',
                                name: 'project.query',
                                arguments: query,
                            },
                        ],
                        providerTurn: {
                            provider: 'openai' as const,
                            assistantItems: [{ type: 'function_call', call_id: 'role-query' }],
                        },
                    };
                }
                expect(turn.history[0]?.receipts[0]?.data).toEqual(ownerReceipt);
                expect(turn.receiptContext).toContain('"canonicalRole":{"role":"kick","source":"clip-content"');
                return { status: 'complete' as const, toolCalls: [] };
            });
            const result = await runApplicationOwnedToolLoop({
                loopId: 'canonical-roles',
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            expect(result.status).toBe('complete');
            expect(requestTurn).toHaveBeenCalledTimes(2);
            expect(result.receipts[0]?.data).toEqual(ownerReceipt);
            expect(result.receipts[0]?.status).toBe('success');
            expect(JSON.stringify(result.receipts)).not.toMatch(/"notes"|"pitch"|"velocity"|audioBuffers|deviceState/);
            expect(captureProjectRevision()).toBe(before);
        }
    );
});

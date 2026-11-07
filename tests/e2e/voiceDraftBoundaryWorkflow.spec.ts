import { type Page } from '@playwright/test';

import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

type VoiceTerminalPayload = { session_id: string; text: string; duration_ms: number };
type VoiceBoundaryProbe = {
    starts: string[];
    stops: string[];
    cancels: string[];
    unexpected: string[];
    queueTerminal: (sessionId: string, payload: VoiceTerminalPayload) => string;
    deliverQueued: (queueId: string) => number;
};

declare global {
    // oxlint-disable-next-line typescript/consistent-type-definitions -- Window must merge with the DOM global.
    interface Window {
        __SOURDAW_VOICE_BOUNDARY__?: VoiceBoundaryProbe;
    }
}

async function readTruth(page: Page) {
    return page.evaluate(async () => {
        const { getCrdtDoc, settlePendingProjectWritesAndCaptureRevision } =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        const { actionHistoryStore } = await import('/src/modules/CrdtDocument/stores/index.ts');
        const { agentRunStore, pendingActionConfirmationStore } =
            await import('/src/modules/AiRuntime/stores/index.ts');
        const revision = settlePendingProjectWritesAndCaptureRevision();
        const root = getCrdtDoc<{
            tracks: { tracks: Array<{ id: string; name: string; kind: string }> };
        }>('root');
        if (!root?.tracks) {
            throw new Error('The voice workflow requires real project track authority');
        }
        const tracks = trackStore.value?.tracks ?? [];
        const snapshot = (value: unknown): unknown => {
            const serialized = JSON.stringify(value);
            if (serialized === undefined) {
                return undefined;
            }
            return JSON.parse(serialized);
        };
        return {
            revision,
            document: snapshot(root),
            tracks: tracks.map((track) => ({ id: track.id, name: track.name, kind: track.kind })),
            rawTracks: root.tracks.tracks.map((track) => ({ id: track.id, name: track.name, kind: track.kind })),
            master: snapshot(tracks.filter((track) => track.kind === 'master')),
            rawMaster: snapshot(root.tracks.tracks.filter((track) => track.kind === 'master')),
            undo: snapshot(undoHistoryStore.value),
            history: snapshot(actionHistoryStore.value),
            runs: snapshot(agentRunStore.value),
            confirmations: snapshot(pendingActionConfirmationStore.value),
        };
    });
}

// This exercises the renderer's consumer of the native voice IPC contract.
// Native model verification, microphone capture, Whisper and preload capability
// issuance are outside this fixture; trusted gestures and all app writes are real.
test('native transcript stays a draft until explicit submission and confirmation', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Voice boundary acceptance requires the app origin');
    }
    const appOrigin = new URL(configuredBaseUrl).origin;
    const externalRequests: string[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol !== 'blob:' && url.protocol !== 'data:' && url.origin !== appOrigin) {
            externalRequests.push(`${request.method()} ${request.url()}`);
        }
    });

    await page.addInitScript(() => {
        const terminals = new Map<string, Set<(event: string, payload: unknown) => void>>();
        const queuedTerminals = new Map<
            string,
            { callbacks: Array<(event: string, payload: unknown) => void>; payload: VoiceTerminalPayload }
        >();
        const probe: VoiceBoundaryProbe = {
            starts: [],
            stops: [],
            cancels: [],
            unexpected: [],
            queueTerminal: (sessionId, payload) => {
                // Native events already queued retain their original callback
                // even when the application unsubscribes before later delivery.
                const callbacks = [...(terminals.get(sessionId) ?? [])];
                if (callbacks.length === 0) {
                    throw new Error('No native terminal subscription to capture');
                }
                const queueId = crypto.randomUUID();
                queuedTerminals.set(queueId, { callbacks, payload });
                return queueId;
            },
            deliverQueued: (queueId) => {
                const queued = queuedTerminals.get(queueId);
                if (queued === undefined) {
                    throw new Error('Unknown queued native terminal');
                }
                queuedTerminals.delete(queueId);
                for (const callback of queued.callbacks) {
                    callback('dictation-result', queued.payload);
                }
                return queued.callbacks.length;
            },
        };
        const refuse = (command: string): Promise<never> => {
            probe.unexpected.push(command);
            return Promise.reject(new Error(`Unexpected native boundary call: ${command}`));
        };
        const events = new Map<string, Set<(payload: unknown) => void>>();
        const bridge: SourdawDesktopBridge = {
            platform: 'linux',
            display: { setZoomFactor: () => undefined },
            invoke: (command) => {
                // These are native endpoint responses, not application-store writes.
                if (command === 'load_cached_whisper_model' || command === 'disarm_retrospective_capture') {
                    return Promise.resolve();
                }
                if (command === 'list_midi_inputs') return Promise.resolve([]);
                if (command === 'unload_plugin') {
                    return Promise.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
                }
                if (command === 'engine_rt_diagnostics') return Promise.resolve({ running: false, events: [] });
                return refuse(command);
            },
            invokeBinary: (command) => refuse(command),
            invokeBinaryResponse: (command) => refuse(command),
            stream: (command) => refuse(command),
            listen: (event, callback) => {
                const callbacks = events.get(event) ?? new Set<(payload: unknown) => void>();
                callbacks.add(callback);
                events.set(event, callbacks);
                return () => callbacks.delete(callback);
            },
            dialog: {
                open: () => refuse('dialog.open'),
                save: () => refuse('dialog.save'),
                message: () => refuse('dialog.message'),
            },
            paths: { samplesBase: () => refuse('paths.samplesBase'), join: () => refuse('paths.join') },
            voiceDictation: {
                start: async (sessionId) => {
                    probe.starts.push(sessionId);
                    return sessionId;
                },
                stop: async (sessionId) => {
                    probe.stops.push(sessionId);
                },
                cancel: async (sessionId) => {
                    probe.cancels.push(sessionId);
                },
                listenTerminal: (sessionId, callback) => {
                    const callbacks = terminals.get(sessionId) ?? new Set<(event: string, payload: unknown) => void>();
                    callbacks.add(callback);
                    terminals.set(sessionId, callbacks);
                    return () => callbacks.delete(callback);
                },
            },
            windowControls: {
                minimize: () => Promise.resolve(),
                toggleMaximize: () => Promise.resolve(false),
                close: () => Promise.resolve(),
                isMaximized: () => Promise.resolve(false),
                listenMaximized: () => () => undefined,
            },
            nativeMenu: {
                listen: () => () => undefined,
                projectState: () => Promise.resolve(),
                saveResult: () => Promise.resolve(),
                listenSessionQuiesce: () => () => undefined,
                listenSessionQuiesceCancel: () => () => undefined,
                sessionQuiesced: () => Promise.resolve(),
                sessionQuiesceStarted: () => Promise.resolve(true),
            },
        };
        window.__SOURDAW_VOICE_BOUNDARY__ = probe;
        Reflect.set(window, 'sourdaw', bridge);
    });

    await setupWorkspace(page);
    await launch_new_project(page);
    const input = page.getByRole('textbox', { name: 'Prompt command input', exact: true });
    const mic = page.getByTestId('voice-command-button');
    await expect(input).toHaveValue('');
    await expect(mic).toBeVisible();
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    const baseline = await readTruth(page);
    expect(baseline.tracks).toEqual([{ id: expect.any(String), name: 'Master', kind: 'master' }]);
    expect(baseline.rawTracks).toEqual(baseline.tracks);
    expect(baseline.rawMaster).toEqual(baseline.master);

    // Playwright produces a trusted native event; no forged gesture or direct
    // draft injection can bypass the application's voice-control admission.
    await mic.click();
    await expect.poll(() => page.evaluate(() => window.__SOURDAW_VOICE_BOUNDARY__?.starts.length)).toBe(1);
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    const sessionId = await page.evaluate(() => window.__SOURDAW_VOICE_BOUNDARY__?.starts[0]);
    if (sessionId === undefined) {
        throw new Error('The trusted voice click did not start a native session');
    }
    await page.evaluate((id) => {
        const probe = window.__SOURDAW_VOICE_BOUNDARY__;
        if (probe === undefined) {
            throw new Error('Native boundary fixture is unavailable');
        }
        const queued = probe.queueTerminal(id, {
            session_id: 'another-native-session',
            text: 'delete every track',
            duration_ms: 900,
        });
        probe.deliverQueued(queued);
    }, sessionId);
    await expect(input).toHaveValue('');
    expect(await readTruth(page)).toEqual(baseline);

    await mic.click();
    await expect.poll(() => page.evaluate(() => window.__SOURDAW_VOICE_BOUNDARY__?.stops)).toEqual([sessionId]);
    const transcript = 'create 3 audio tracks';
    const queuedDuplicate = await page.evaluate(
        ({ id, text }) => {
            const probe = window.__SOURDAW_VOICE_BOUNDARY__;
            if (probe === undefined) {
                throw new Error('Native boundary fixture is unavailable');
            }
            const terminal = { session_id: id, text, duration_ms: 1200 };
            const first = probe.queueTerminal(id, terminal);
            const duplicate = probe.queueTerminal(id, terminal);
            probe.deliverQueued(first);
            return duplicate;
        },
        { id: sessionId, text: transcript }
    );
    await expect(input).toHaveValue(transcript);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Changes awaiting review', { exact: true })).toHaveCount(0);
    expect(await readTruth(page)).toEqual(baseline);
    expect(externalRequests).toEqual([]);

    const editedDraft = 'Keep this edited draft';
    await input.fill(editedDraft);
    expect(
        await page.evaluate((queueId) => window.__SOURDAW_VOICE_BOUNDARY__?.deliverQueued(queueId), queuedDuplicate)
    ).toBeGreaterThan(0);
    await expect(input).toHaveValue(editedDraft);
    await expect(page.getByText('Changes awaiting review', { exact: true })).toHaveCount(0);
    expect(await readTruth(page)).toEqual(baseline);
    expect(externalRequests).toEqual([]);

    await input.fill(transcript);
    await input.press('Enter');
    await expect(page.getByText('Changes awaiting review', { exact: true })).toBeVisible({ timeout: 20_000 });
    const proposed = await readTruth(page);
    expect(proposed.document).toEqual(baseline.document);
    expect(proposed.revision).toBe(baseline.revision);
    expect(proposed.tracks).toEqual(baseline.tracks);
    expect(proposed.undo).toEqual(baseline.undo);
    expect(proposed.history).toEqual(baseline.history);
    expect(proposed.runs).not.toEqual(baseline.runs);
    expect(proposed.confirmations).not.toEqual(baseline.confirmations);

    await page.getByRole('button', { name: 'Review in Agent', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Confirm agent actions', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();
    const armButtons = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('button', { name: /^Arm / });
    await expect(armButtons).toHaveCount(3, { timeout: 20_000 });
    const committed = await readTruth(page);
    const createdAudioTracks = committed.tracks.filter((track) => track.kind === 'audio');
    expect(createdAudioTracks).toHaveLength(3);
    expect(new Set(createdAudioTracks.map((track) => track.id)).size).toBe(3);
    expect(createdAudioTracks.every((track) => !baseline.tracks.some((prior) => prior.id === track.id))).toBe(true);
    expect(committed.tracks).toHaveLength(baseline.tracks.length + 3);
    expect(committed.rawTracks).toEqual(committed.tracks);
    expect(committed.master).toEqual(baseline.master);
    expect(committed.rawMaster).toEqual(baseline.rawMaster);
    expect(committed.document).not.toEqual(baseline.document);
    expect(committed.history).not.toEqual(baseline.history);
    const undoEntries = await page.evaluate(async () => {
        const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
        return (undoHistoryStore.value?.past ?? []).map((entry) => ({ source: entry.source, groupId: entry.groupId }));
    });
    expect(undoEntries).toHaveLength(3);
    expect(undoEntries.every((entry) => entry.groupId === undoEntries[0]?.groupId)).toBe(true);
    expect(undoEntries[0]?.groupId).toBeTruthy();
    await page.getByTestId('transport-undo').click();
    await expect(armButtons).toHaveCount(0);
    const undone = await readTruth(page);
    expect(undone.tracks).toEqual(baseline.tracks);
    expect(undone.rawTracks).toEqual(baseline.rawTracks);
    expect(undone.master).toEqual(baseline.master);
    expect(undone.rawMaster).toEqual(baseline.rawMaster);
    expect(externalRequests).toEqual([]);
    const native = await page.evaluate(() => ({
        starts: window.__SOURDAW_VOICE_BOUNDARY__?.starts,
        stops: window.__SOURDAW_VOICE_BOUNDARY__?.stops,
        unexpected: window.__SOURDAW_VOICE_BOUNDARY__?.unexpected,
    }));
    expect(native).toEqual({ starts: [sessionId], stops: [sessionId], unexpected: [] });
    await testInfo.attach('voice-draft-boundary', {
        body: JSON.stringify({ baseline, proposed, committed, undone, undoEntries, native, externalRequests }, null, 2),
        contentType: 'application/json',
    });
});

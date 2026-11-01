import { expect, test, type Page } from '@playwright/test';

import { advertisedAnswerCandidateId } from '../../src/modules/AiRuntime/useCases/__tests__/answerWireFixture';
import { admitLoopbackProvider } from './admitLoopbackProvider';
import { launch_new_project, setupWorkspace } from './e2eUtils';
import { startScriptedToolProvider, type ScriptedToolRequest } from './scriptedToolProvider';

const PROMPT = 'Match Drums loudness to Bass over Chorus';

type FixtureSubjects = { drumsId: string; bassId: string; deviceId: string; trimId: string; sectionId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new TypeError('Expected a published planning object.');
    }
    return value;
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError('Expected a published planning array.');
    }
    return value;
}
function text(value: unknown): string {
    if (typeof value !== 'string') {
        throw new TypeError('Expected an actual published candidate ID.');
    }
    return value;
}

/** Select only IDs and semantics in the genuine hosted schema and complete shared view. */
function comparisonIntake(request: ScriptedToolRequest, drumsId: string, bassId: string) {
    const tool = request.tools.find((candidate) => candidate.function.name === 'selectCreativeInterpretation');
    if (tool === undefined) {
        throw new Error('Missing the actual joint intake tool.');
    }
    const properties = tool.function.parameters.properties;
    const view = record(JSON.parse((tool.function.description ?? '').split('View: ').at(-1) ?? 'null'));
    const targets = array(view.targets).map(array);
    const targetIds = array(record(record(properties.targetCandidateIds).items).enum).map(text);
    const dimensionIds = array(record(record(properties.editDimensionCandidateIds).items).enum).map(text);
    const dimensions = array(view.dimensions).map(text);
    const targetIndex = targets.findIndex((row) => row[1] === 'track' && row[4] === 'Drums');
    const dimensionIndex = dimensions.indexOf('processing');
    const metric = array(record(properties.metricIntent).anyOf)
        .map(record)
        .find((branch) => branch.properties !== undefined);
    if (targetIndex < 0 || dimensionIndex < 0 || metric === undefined) {
        throw new Error('The actual catalog did not admit the requested bounded comparison.');
    }
    const objectiveProperties = record(record(record(record(metric.properties).objectives).items).properties);
    const objectiveIds = array(record(objectiveProperties.objectiveId).enum).map(text);
    const expectations = array(view.metricExpectations).map(array);
    const policies = array(view.metricPolicies).map(text);
    const policyIndex = policies.indexOf('integrated-loudness-match-v1');
    const objectiveIndex = array(view.metricObjectives)
        .map(array)
        .findIndex((row) =>
            array(row[6]).some((reference) => {
                if (typeof reference !== 'number' || !Number.isSafeInteger(reference)) {
                    throw new TypeError('Expected a published metric expectation index.');
                }
                const expectation = expectations[reference];
                if (expectation === undefined) {
                    return false;
                }
                return (
                    policyIndex >= 0 &&
                    expectation[5] === policyIndex &&
                    expectation[2] === 'match-current' &&
                    expectation[4] === 0.1
                );
            })
        );
    const objectiveId = objectiveIds[objectiveIndex];
    if (objectiveIndex < 0 || objectiveId === undefined) {
        throw new Error('Missing the actual published loudness-match policy objective.');
    }
    return {
        id: 'metric-intake',
        name: tool.function.name,
        arguments: {
            catalogId: text(record(properties.catalogId).const),
            modeId: 'edit',
            uncertainty: 'none',
            targetCandidateIds: [text(targetIds[targetIndex])],
            editDimensionCandidateIds: [text(dimensionIds[dimensionIndex])],
            constraintCandidateIds: [],
            creationSlotIds: [],
            answer: null,
            metricIntent: {
                kind: 'comparative',
                uncertainty: 'none',
                objectives: [
                    {
                        objectiveId,
                        scopeCandidateId: advertisedAnswerCandidateId(request, drumsId),
                        referenceScopeCandidateId: advertisedAnswerCandidateId(request, bassId),
                        rangeCandidateId: advertisedAnswerCandidateId(request, 'Chorus', 'ranges'),
                    },
                ],
            },
        },
    };
}

async function projectTruth(page: Page) {
    return page.evaluate(async () => {
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const command: typeof import('../../src/modules/Command/stores') =
            await import('/src/modules/Command/stores/index.ts');
        const history: typeof import('../../src/modules/CrdtDocument/stores') =
            await import('/src/modules/CrdtDocument/stores/index.ts');
        const tracks: typeof import('../../src/modules/Arrangement/stores') =
            await import('/src/modules/Arrangement/stores/index.ts');
        const audio: typeof import('../../src/modules/AudioEngine/useCases') =
            await import('/src/modules/AudioEngine/useCases/index.ts');
        crdt.settlePendingProjectWritesAndCaptureRevision();
        const pcm = [];
        for (const track of tracks.trackStore.value?.tracks ?? []) {
            for (const clip of track.clips) {
                if (clip.audioBufferId === undefined) continue;
                const buffer = audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId });
                if (buffer === null) throw new Error('A real source buffer disappeared.');
                const hashes = [];
                for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                    const samples = buffer.getChannelData(channel);
                    const hash = await crypto.subtle.digest(
                        'SHA-256',
                        new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
                    );
                    hashes.push(
                        Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')
                    );
                }
                pcm.push({ id: clip.audioBufferId, hashes });
            }
        }
        return {
            revision: crdt.captureProjectRevision(),
            document: JSON.stringify(crdt.getCrdtDoc('root')),
            undo: JSON.stringify(command.undoHistoryStore.value),
            history: JSON.stringify(history.actionHistoryStore.value),
            pcm,
        };
    });
}

async function fixtureState(page: Page, subjects: FixtureSubjects) {
    return page.evaluate(async ({ drumsId, bassId, deviceId, trimId, sectionId }) => {
        const stores: typeof import('../../src/modules/Arrangement/stores') =
            await import('/src/modules/Arrangement/stores/index.ts');
        const arrangement: typeof import('../../src/modules/Arrangement/useCases') =
            await import('/src/modules/Arrangement/useCases/index.ts');
        const project: typeof import('../../src/modules/Project/stores') =
            await import('/src/modules/Project/stores/index.ts');
        const section = stores.markerStore.value?.sections.find((entry) => entry.id === sectionId);
        const projectId = project.projectStore.value?.projectId;
        if (section === undefined || projectId === undefined) throw new Error('Missing genuine fixture identity.');
        return {
            projectId,
            tracks: [drumsId, bassId].map((id) => {
                const track = stores.trackStore.value?.tracks.find((entry) => entry.id === id);
                if (track === undefined) throw new Error('Missing genuine fixture track.');
                return {
                    id: track.id,
                    name: track.name,
                    gain: track.gain,
                    clips: track.clips.map((clip) => ({ id: clip.id, audioBufferId: clip.audioBufferId })),
                    devices: track.devices.map((device) => ({ id: device.id, type: device.type })),
                };
            }),
            section: { id: section.id, name: section.name, startBeat: section.startBeat, endBeat: section.endBeat },
            levels: [deviceId, trimId].map((id) => arrangement.getEligibleDeviceParameterValues(id)?.['gain-level']),
        };
    }, subjects);
}

type ProbeBlock = { frame: number; selected: number[]; upstream: number[] };
type SourceStart = {
    side: 'baseline' | 'preview';
    frame: number;
    gain: number;
    expectedGain: number;
    offset: number;
    duration: number | null;
    frames: number;
    expectedFrames: number;
};
declare global {
    interface Window {
        measuredAuditionProbe?: {
            blocks: ProbeBlock[];
            starts: SourceStart[];
            reset: () => void;
            close: () => void;
            holdResume: () => Promise<void>;
            releaseResume: () => void;
            resumeFrame: () => number | null;
            gateCuts: () => { toPreviewOutput: boolean; time: number; calledAt: number; stack: string }[];
            resumeCalls: () => { time: number; frame: number; calledAt: number; stack: string }[];
            residual: () => { residual: number; outputEnergy: number; upstreamEnergy: number; count: number } | null;
        };
    }
}

/** Actual browser software output; this deliberately makes no physical-device claim. */
async function installOutputProbe(page: Page, confirmationId: string) {
    await page.evaluate(async (id) => {
        const audio: typeof import('../../src/modules/AudioEngine/useCases') =
            await import('/src/modules/AudioEngine/useCases/index.ts');
        const runtime: typeof import('../../src/modules/AiRuntime/stores') =
            await import('/src/modules/AiRuntime/stores/index.ts');
        const rendering: typeof import('../../src/modules/AudioRendering/useCases') =
            await import('/src/modules/AudioRendering/useCases/index.ts');
        const confirmation = runtime.pendingActionConfirmationStore.value?.confirmations.find(
            (entry) => entry.id === id
        );
        const codec: typeof import('../../src/modules/AiRuntime/useCases/metricGoalStateCodec') =
            await import('/src/modules/AiRuntime/useCases/metricGoalStateCodec.ts');
        // Read the genuine producer's retained addresses, never supply an audition resource.
        const raw = codec.metricGoalStateCodec(confirmation?.approvalSnapshot.metricGoalState);
        if (raw === null) throw new Error('Missing actual measured proof.');
        const proof = raw.proofs.at(-1);
        const target = proof?.preview.targets.find((entry) => entry.targetKind === 'track');
        const baseline = rendering.getAgentMeasurementArtifact(
            target?.audition?.baseline?.artifact?.contentAddress ?? ''
        );
        const proposal = rendering.getAgentMeasurementArtifact(
            target?.audition?.preview?.artifact?.contentAddress ?? ''
        );
        if (baseline === null || proposal === null) throw new Error('The current exact retained pair is unavailable.');
        const baselineLufs = target?.audition?.baselineIntegratedLoudness;
        const proposedLufs = target?.audition?.previewIntegratedLoudness;
        if (
            baselineLufs?.status !== 'measured' ||
            proposedLufs?.status !== 'measured' ||
            typeof baselineLufs.value !== 'number' ||
            typeof proposedLufs.value !== 'number' ||
            !Number.isFinite(baselineLufs.value) ||
            !Number.isFinite(proposedLufs.value)
        )
            throw new Error('Missing genuine finite match figures.');
        const match = Math.min(baselineLufs.value, proposedLufs.value);
        const expectedGains = {
            baseline: 10 ** ((match - baselineLufs.value) / 20),
            preview: 10 ** ((match - proposedLufs.value) / 20),
        };
        const context = audio.audioEngine.context;
        // This deterministic fixture uses one known rate; production accepts differing formats.
        if (baseline.sampleRate !== context.sampleRate || proposal.sampleRate !== context.sampleRate)
            throw new Error('Unexpected software oracle fixture sample rate.');
        const blocks: ProbeBlock[] = [];
        const starts: SourceStart[] = [];
        const module = new Blob(
            [
                `class AuditionTap extends AudioWorkletProcessor {
            process(inputs) {
                this.port.postMessage({ frame: currentFrame, selected: Array.from(inputs[0]?.[0] ?? []), upstream: Array.from(inputs[1]?.[0] ?? []) });
                return true;
            }
        } registerProcessor('measured-audition-tap', AuditionTap);`,
            ],
            { type: 'text/javascript' }
        );
        const url = URL.createObjectURL(module);
        try {
            await context.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        const tap = new AudioWorkletNode(context, 'measured-audition-tap', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });
        const silentPull = context.createGain();
        silentPull.gain.value = 0;
        audio.audioEngine.audioPreviewOutput.connect(tap, 0, 0);
        audio.audioEngine.masterAnalyser.connect(tap, 0, 1);
        tap.connect(silentPull);
        silentPull.connect(context.destination);
        tap.port.onmessage = (event: MessageEvent<ProbeBlock>) => {
            if (blocks.length < 256) blocks.push(event.data);
        };
        const originalFactory = context.createBufferSource;
        context.createBufferSource = new Proxy(originalFactory, {
            apply(factory, receiver, args) {
                const source: AudioBufferSourceNode = Reflect.apply(factory, receiver, args);
                let gain = 1;
                source.connect = new Proxy(source.connect, {
                    apply(connect, node, connectArgs) {
                        if (connectArgs[0] instanceof GainNode) gain = connectArgs[0].gain.value;
                        return Reflect.apply(connect, node, connectArgs);
                    },
                });
                source.start = new Proxy(source.start, {
                    apply(start, node, startArgs) {
                        const side =
                            source.buffer === baseline.buffer
                                ? 'baseline'
                                : source.buffer === proposal.buffer
                                  ? 'preview'
                                  : null;
                        if (side !== null)
                            starts.push({
                                side,
                                frame: Math.round(context.currentTime * context.sampleRate),
                                gain,
                                expectedGain: expectedGains[side],
                                offset: typeof startArgs[1] === 'number' ? startArgs[1] : 0,
                                duration: typeof startArgs[2] === 'number' ? startArgs[2] : null,
                                frames: source.buffer!.length,
                                expectedFrames: (side === 'baseline' ? baseline : proposal).frameCount,
                            });
                        return Reflect.apply(start, node, startArgs);
                    },
                });
                return source;
            },
        });
        let releaseResume = () => {};
        let resumeFrame: number | null = null;
        const gateCuts: { toPreviewOutput: boolean; time: number; calledAt: number; stack: string }[] = [];
        const resumeCalls: { time: number; frame: number; calledAt: number; stack: string }[] = [];
        let releaseGateObserver = () => {};
        const originalResume = context.resume;
        const holdResume = async () => {
            await context.suspend();
            const gate: unknown = Reflect.get(audio.audioEngine, 'previewProgrammeGate');
            if (!(gate instanceof GainNode)) throw new Error('Missing actual programme gate.');
            const originalDisconnect = gate.disconnect;
            gate.disconnect = new Proxy(originalDisconnect, {
                apply(disconnect, receiver, args) {
                    gateCuts.push({
                        toPreviewOutput: args[0] === audio.audioEngine.audioPreviewOutput,
                        time: context.currentTime,
                        calledAt: performance.now(),
                        stack: new Error('Programme gate disconnect caller').stack ?? '',
                    });
                    return Reflect.apply(disconnect, receiver, args);
                },
            });
            releaseGateObserver = () => {
                gate.disconnect = originalDisconnect;
            };
            const held = Promise.withResolvers<void>();
            releaseResume = () => {
                context.resume = originalResume;
                releaseGateObserver();
                held.resolve();
            };
            context.resume = new Proxy(originalResume, {
                apply(resume, receiver, args) {
                    const time = context.currentTime;
                    const call = {
                        time,
                        frame: Math.round(time * context.sampleRate),
                        calledAt: performance.now(),
                        stack: new Error('Actual AudioContext resume caller').stack ?? '',
                    };
                    resumeCalls.push(call);
                    resumeFrame ??= call.frame;
                    const resumed: Promise<void> = Reflect.apply(resume, receiver, args);
                    return Promise.all([resumed, held.promise]).then(() => undefined);
                },
            });
        };
        window.measuredAuditionProbe = {
            blocks,
            starts,
            holdResume,
            releaseResume: () => releaseResume(),
            resumeFrame: () => resumeFrame,
            gateCuts: () => gateCuts,
            resumeCalls: () => resumeCalls,
            reset: () => {
                blocks.length = 0;
                starts.length = 0;
            },
            close: () => {
                context.resume = originalResume;
                releaseGateObserver();
                releaseResume();
                context.createBufferSource = originalFactory;
                audio.audioEngine.audioPreviewOutput.disconnect(tap);
                audio.audioEngine.masterAnalyser.disconnect(tap);
                tap.disconnect();
                silentPull.disconnect();
                tap.port.close();
            },
            residual: () => {
                const start = starts.at(-1);
                if (start === undefined) return null;
                const selectedBlocks = blocks.filter((block) => block.frame >= start.frame + 512).slice(0, 8);
                if (selectedBlocks.length !== 8) return null;
                const expected = (start.side === 'baseline' ? baseline : proposal).buffer.getChannelData(0);
                let residual = Infinity;
                for (let shift = -256; shift <= 256; shift++) {
                    let maximum = 0;
                    for (const block of selectedBlocks)
                        for (let index = 0; index < block.selected.length; index++) {
                            const expectedIndex = block.frame - start.frame + index + shift;
                            maximum = Math.max(
                                maximum,
                                Math.abs(block.selected[index]! - (expected[expectedIndex] ?? 0) * start.expectedGain)
                            );
                        }
                    residual = Math.min(residual, maximum);
                }
                return {
                    residual,
                    count: 1024,
                    outputEnergy: selectedBlocks.reduce(
                        (sum, block) => sum + block.selected.reduce((n, x) => n + x * x, 0),
                        0
                    ),
                    upstreamEnergy: selectedBlocks.reduce(
                        (sum, block) => sum + block.upstream.reduce((n, x) => n + x * x, 0),
                        0
                    ),
                };
            },
        };
    }, confirmationId);
}

test('auditions one genuine retained measured request before Confirm without project or PCM mutation', async ({
    page,
}) => {
    test.setTimeout(240_000);
    await setupWorkspace(page, { clearLocalStorage: false });
    await launch_new_project(page);
    const subjects = await page.evaluate(async () => {
        const command: typeof import('../../src/modules/Command/useCases') =
            await import('/src/modules/Command/useCases/index.ts');
        const audio: typeof import('../../src/modules/AudioEngine/useCases') =
            await import('/src/modules/AudioEngine/useCases/index.ts');
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const drumsId = crypto.randomUUID();
        const bassId = crypto.randomUUID();
        const deviceId = crypto.randomUUID();
        const trimId = crypto.randomUUID();
        const sectionId = crypto.randomUUID();
        for (const [id, name, gain] of [
            [drumsId, 'Drums', 0.8],
            [bassId, 'Bass', 0.4],
        ] as const) {
            await command.executeAppAction({ type: 'addTrack', payload: { id, name, kind: 'audio' } });
            const arrangement: typeof import('../../src/modules/Arrangement/stores') =
                await import('/src/modules/Arrangement/stores/index.ts');
            const currentTrack = arrangement.trackStore.value?.tracks.find((track) => track.id === id);
            if (currentTrack === undefined) {
                throw new Error('Missing the genuine seeded track.');
            }
            const expectedGain = currentTrack.gain;
            await command.executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: id, gain, expectedGain },
            });
            const updatedTrack = arrangement.trackStore.value?.tracks.find((track) => track.id === id);
            if (updatedTrack?.gain !== gain) {
                throw new Error('The typed gain action did not update the genuine track.');
            }
            const rate = 48_000;
            const buffer = new AudioBuffer({ numberOfChannels: 2, sampleRate: rate, length: rate * 2 });
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const samples = buffer.getChannelData(channel);
                for (let frame = 0; frame < samples.length; frame++) {
                    const seconds = frame / rate;
                    const envelope = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.73 * seconds);
                    samples[frame] = 0.2 * envelope * Math.sin(2 * Math.PI * (550 * seconds + 180 * seconds * seconds));
                }
            }
            const audioBufferId = audio.cacheAudioBuffer({ buffer });
            await command.executeAppAction({
                type: 'addClip',
                payload: {
                    trackId: id,
                    name: `${name} sine`,
                    type: 'audio',
                    startBeat: 0,
                    endBeat: 4,
                    audioBufferId,
                },
            });
        }
        await command.executeAppAction({
            type: 'addDevice',
            payload: { trackId: drumsId, deviceId, deviceType: 'builtin-gain' },
        });
        await command.executeAppAction({
            type: 'addSection',
            payload: { sectionId, name: 'Chorus', startBeat: 0, endBeat: 4 },
        });
        await command.executeAppAction({
            type: 'addDevice',
            payload: { trackId: drumsId, deviceId: trimId, deviceType: 'builtin-gain' },
        });
        const transport: typeof import('../../src/modules/Transport/useCases') =
            await import('/src/modules/Transport/useCases/index.ts');
        transport.setLoopRegion(0, 4);
        crdt.settlePendingProjectWritesAndCaptureRevision();
        return { drumsId, bassId, deviceId, trimId, sectionId };
    });
    const initialFixture = await fixtureState(page, subjects);
    const initialPcm = (await projectTruth(page)).pcm;
    expect(initialFixture.levels).toEqual([0, 0]);
    expect(initialFixture.tracks.map((track) => track.gain)).toEqual([0.8, 0.4]);
    // New-project clear deliberately leaves session Undo unowned. Open the
    // actual saved project before measured work, through normal reconciliation.
    expect(
        await page.evaluate(async () => {
            const project: typeof import('../../src/modules/Project/useCases') =
                await import('/src/modules/Project/useCases/index.ts');
            return project.saveProject();
        })
    ).toBe(true);
    await page.reload();
    await expect
        .poll(
            () =>
                page.evaluate(async () => {
                    const stores: typeof import('../../src/modules/Project/stores') =
                        await import('/src/modules/Project/stores/index.ts');
                    const project: typeof import('../../src/modules/Project/useCases') =
                        await import('/src/modules/Project/useCases/index.ts');
                    const state = stores.projectStore.value;
                    return {
                        projectId: state?.projectId,
                        initialized: state?.initialized,
                        loading: state?.loading,
                        owner: project.getDurableProjectOwnerId(),
                    };
                }),
            { timeout: 30_000 }
        )
        .toEqual({
            projectId: initialFixture.projectId,
            initialized: true,
            loading: false,
            owner: initialFixture.projectId,
        });
    expect(await fixtureState(page, subjects)).toEqual(initialFixture);
    expect((await projectTruth(page)).pcm).toEqual(initialPcm);
    const initialOpen = await page.evaluate(async () => {
        const project: typeof import('../../src/modules/Project/stores') =
            await import('/src/modules/Project/stores/index.ts');
        const command: typeof import('../../src/modules/Command/stores') =
            await import('/src/modules/Command/stores/index.ts');
        const crdt: typeof import('../../src/modules/CrdtDocument/useCases') =
            await import('/src/modules/CrdtDocument/useCases/index.ts');
        const rendering: typeof import('../../src/modules/AudioRendering/useCases') =
            await import('/src/modules/AudioRendering/useCases/index.ts');
        return {
            project: project.projectStore.value,
            undo: command.undoHistoryStore.value,
            mirror: window.sessionStorage.getItem('sourdaw-undo-session'),
            witness: crdt.captureDurableDocumentWitness(),
            retained: rendering.getAgentMeasurementArtifacts().length,
        };
    });
    expect(initialOpen.retained).toBe(0);
    await test.info().attach('initial-normally-opened-project', {
        body: JSON.stringify(initialOpen),
        contentType: 'application/json',
    });
    const egress: string[] = [];
    page.on('request', (request) => {
        if (request.method() !== 'POST') return;
        const contentType = request.headers()['content-type'] ?? '';
        if (/audio|octet-stream|multipart/i.test(contentType)) egress.push(`${request.url()} ${contentType}`);
    });
    const provider = await startScriptedToolProvider((request, turn) => {
        if (turn === 0) return [comparisonIntake(request, subjects.drumsId, subjects.bassId)];
        if (turn === 1)
            return [
                {
                    id: 'audition-discovery',
                    name: 'agent_catalog_discover',
                    arguments: { category: 'command', names: ['setDeviceParameter'] },
                },
            ];
        if (turn === 3) {
            // The held comparative proposal's measurement step offers the measurement tool alone. A
            // live master read witnesses the step without proving the unapplied preview.
            expect(request.tools.map((tool) => tool.function.name)).toEqual(['analysis_measure']);
            return [
                {
                    id: 'audition-step-measurement',
                    name: 'analysis_measure',
                    arguments: { scope: { kind: 'master' }, range: { startBeat: 0, endBeat: 4 } },
                },
            ];
        }
        expect(turn).toBe(2);
        return [
            {
                id: 'audition-proposal',
                name: 'command_batch_propose',
                arguments: {
                    commands: [
                        {
                            name: 'setDeviceParameter',
                            arguments: {
                                deviceId: subjects.deviceId,
                                paramId: 'gain-level',
                                value: 20 * Math.log10(0.5) + 1,
                            },
                        },
                        {
                            name: 'setDeviceParameter',
                            arguments: { deviceId: subjects.trimId, paramId: 'gain-level', value: -1 },
                        },
                    ],
                    plan: {
                        semantic: { classification: 'complex', uncertainty: [] },
                        objective: PROMPT,
                        constraints: ['Require compatible measured proof.'],
                        scope: {
                            targetIds: [subjects.deviceId, subjects.trimId, 'gain-level', subjects.drumsId],
                            targetRanges: [],
                            protectedTargetIds: [],
                            protectedRanges: [],
                        },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: ['Verify the actual measured preview.'],
                        stoppingConditions: ['Do not apply without measured proof.'],
                    },
                },
            },
        ];
    });
    try {
        await admitLoopbackProvider(page, provider);
        await page.getByTestId('transport-metronome').click();
        await page.getByTestId('transport-play').click();
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const transport: typeof import('../../src/modules/Transport/stores') =
                        await import('/src/modules/Transport/stores/index.ts');
                    return transport.transportStore.value?.isPlaying && transport.playheadPositionRef.current > 0;
                })
            )
            .toBe(true);
        const beforeRequest = await projectTruth(page);
        await page.getByTestId('prompt-input').fill(PROMPT);
        await page.getByTestId('prompt-input').press('Enter');
        await expect(page.getByText('Changes awaiting review', { exact: true })).toBeVisible({ timeout: 45_000 });
        await page.getByRole('button', { name: 'Review in Agent' }).click();
        const confirm = page.getByRole('button', { name: 'Confirm agent actions' });
        await expect(confirm).toBeVisible();
        await expect(confirm).toBeDisabled();
        expect(await projectTruth(page)).toEqual(beforeRequest);
        await page.getByRole('button', { name: 'Re-preview agent actions', exact: true }).click();
        await expect(confirm).toBeEnabled({ timeout: 60_000 });
        const comparison = page.getByRole('region', { name: 'Measured audio comparison' });
        await expect(comparison).toHaveCount(1);
        await expect(comparison.getByRole('button', { name: 'Baseline', exact: true })).toBeEnabled();
        const current = await page.evaluate(async () => {
            const stores: typeof import('../../src/modules/AiRuntime/stores') =
                await import('/src/modules/AiRuntime/stores/index.ts');
            const current = stores.pendingActionConfirmationStore.value?.confirmations.findLast(
                (entry) => entry.status === 'proposed'
            );
            if (current === undefined) throw new Error('Missing real re-preview confirmation.');
            const receipts = stores.agentRunStore.value?.runs.find((run) => run.runId === current.runId)?.plan
                ?.applicationToolReceipts;
            if (
                !receipts?.some(
                    (entry) =>
                        entry.status === 'success' &&
                        entry.toolName === 'analysis.measure' &&
                        entry.origin === 'application-verification'
                )
            )
                throw new Error('No genuine application preview receipt.');
            return { id: current.id };
        });
        expect(await projectTruth(page)).toEqual(beforeRequest);
        await installOutputProbe(page, current.id);
        const beforeAudition = await projectTruth(page);
        expect(beforeAudition).toEqual(beforeRequest);
        await expect(comparison.getByRole('button', { name: 'Baseline', exact: true })).toBeEnabled();
        const clockBefore = await page.evaluate(async () => {
            const transport: typeof import('../../src/modules/Transport/stores') =
                await import('/src/modules/Transport/stores/index.ts');
            return { beat: transport.playheadPositionRef.current, wraps: transport.playheadWrapCountRef.current };
        });
        for (const side of ['Baseline', 'Proposal', 'Baseline'] as const) {
            await page.evaluate(() => window.measuredAuditionProbe?.reset());
            await comparison.getByRole('button', { name: side, exact: true }).click();
            await expect(comparison.getByRole('status')).toHaveText(
                side === 'Baseline' ? 'Playing baseline' : 'Playing proposal'
            );
            await expect
                .poll(() => page.evaluate(() => window.measuredAuditionProbe?.residual() ?? null))
                .not.toBeNull();
            const observed = await page.evaluate(() => ({
                result: window.measuredAuditionProbe?.residual(),
                starts: window.measuredAuditionProbe?.starts,
            }));
            expect(observed.starts).toHaveLength(1);
            expect(observed.starts?.[0]?.side).toBe(side === 'Baseline' ? 'baseline' : 'preview');
            expect(observed.starts?.[0]?.gain).toBe(Math.fround(observed.starts?.[0]?.expectedGain ?? Number.NaN));
            expect(observed.starts?.[0]?.offset).toBe(0);
            expect(observed.starts?.[0]?.duration).toBeNull();
            expect(observed.starts?.[0]?.frames).toBe(observed.starts?.[0]?.expectedFrames);
            expect(observed.starts?.[0]?.frames).toBeGreaterThan(0);
            expect(observed.starts?.[0]?.gain).toBeGreaterThan(0);
            expect(observed.starts?.[0]?.gain).toBeLessThanOrEqual(1);
            expect(observed.result?.outputEnergy).toBeGreaterThan(0);
            expect(observed.result?.upstreamEnergy).toBeGreaterThan(0);
            expect(observed.result?.residual).toBeLessThan(0.00001);
            expect(await projectTruth(page)).toEqual(beforeAudition);
        }
        const groups = comparison.locator('..').getByRole('checkbox', { name: /^Include group / });
        await expect(groups).toHaveCount(2);
        await groups.nth(1).uncheck();
        await expect(comparison.getByRole('button', { name: 'Proposal', exact: true })).toBeDisabled();
        await expect(comparison.getByRole('status')).toHaveText('Stopped');
        await groups.nth(1).check();
        await expect(comparison.getByRole('button', { name: 'Baseline', exact: true })).toBeEnabled();
        await expect(comparison.getByRole('status')).toHaveText('Stopped');
        // Resume is genuinely invoked in the click, but its completion is held.
        // This observes the gate cut before the actual invocation and real software silence
        // while upstream programme/metronome continue, then cancels by selection.
        await page.evaluate(async () => {
            await window.measuredAuditionProbe?.holdResume();
            window.measuredAuditionProbe?.reset();
        });
        await comparison.getByRole('button', { name: 'Baseline', exact: true }).click();
        await expect(comparison.getByRole('status')).toHaveText('Preparing comparison…');
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const probe = window.measuredAuditionProbe;
                    const frame = probe?.resumeFrame();
                    if (probe === undefined || frame == null) return 0;
                    return probe.blocks.filter((block) => block.frame >= frame).length;
                })
            )
            .toBeGreaterThanOrEqual(8);
        const pending = await page.evaluate(() => ({
            frame: window.measuredAuditionProbe?.resumeFrame(),
            cuts: window.measuredAuditionProbe?.gateCuts(),
            resumeCalls: window.measuredAuditionProbe?.resumeCalls(),
            starts: window.measuredAuditionProbe?.starts.length,
            blocks: window.measuredAuditionProbe?.blocks
                .filter((block) => block.frame >= (window.measuredAuditionProbe?.resumeFrame() ?? Infinity))
                .slice(0, 8)
                .map((block) => ({
                    frame: block.frame,
                    // With the programme cut and no source started, nothing feeds the listening
                    // output, so its tap input carries zero channels: silence, read as a 0 peak.
                    // https://webaudio.github.io/web-audio-api/#dom-audioworkletprocesscallback-inputs
                    selected: Math.max(0, ...block.selected.map(Math.abs)),
                    upstream: block.upstream.reduce((sum, x) => sum + x * x, 0),
                })),
        }));
        await test.info().attach('first-resumed-programme-gate', {
            body: JSON.stringify(pending),
            contentType: 'application/json',
        });
        // The gate is the programme's edge into the listening output. A disconnect is a control
        // message the rendering loop runs before the next quantum it renders, so one made while the
        // context is still suspended on the resume frame closes that frame's first sample:
        // https://webaudio.github.io/web-audio-api/#rendering-loop
        const firstResume = pending.resumeCalls?.[0];
        const cut = pending.cuts?.[0];
        if (firstResume === undefined || cut === undefined) throw new Error('Missing actual gate/resume calls.');
        expect(cut.toPreviewOutput).toBe(true);
        expect(cut.time).toBe(firstResume.time);
        expect(cut.calledAt).toBeLessThan(firstResume.calledAt);
        expect(cut.stack).toContain('beginExclusiveAudioPreviewIntent');
        expect(firstResume.stack).toContain('prepareSource');
        expect(pending.starts).toBe(0);
        expect(pending.blocks?.map((block) => block.frame)).toEqual(
            Array.from({ length: 8 }, (_, index) => firstResume.frame + index * 128)
        );
        expect(pending.blocks?.every((block) => block.selected === 0)).toBe(true);
        expect(pending.blocks?.every((block) => block.upstream > 0)).toBe(true);
        await groups.nth(1).uncheck();
        await expect(comparison.getByRole('status')).toHaveText('Stopped');
        await page.evaluate(() => window.measuredAuditionProbe?.releaseResume());
        await groups.nth(1).check();
        await expect(comparison.getByRole('status')).toHaveText('Stopped');
        expect(await page.evaluate(() => window.measuredAuditionProbe?.starts.length)).toBe(0);
        const clockAfter = await page.evaluate(async () => {
            const transport: typeof import('../../src/modules/Transport/stores') =
                await import('/src/modules/Transport/stores/index.ts');
            return {
                beat: transport.playheadPositionRef.current,
                wraps: transport.playheadWrapCountRef.current,
                playing: transport.transportStore.value?.isPlaying,
            };
        });
        expect(clockAfter.playing).toBe(true);
        expect(clockAfter.wraps * 4 + clockAfter.beat).toBeGreaterThan(clockBefore.wraps * 4 + clockBefore.beat);
        expect(await projectTruth(page)).toEqual(beforeAudition);
        await page.evaluate(() => window.measuredAuditionProbe?.close());
        await confirm.click();
        const levels = () =>
            page.evaluate(async ({ deviceId, trimId }) => {
                const arrangement: typeof import('../../src/modules/Arrangement/useCases') =
                    await import('/src/modules/Arrangement/useCases/index.ts');
                return [deviceId, trimId].map((id) => arrangement.getEligibleDeviceParameterValues(id)?.['gain-level']);
            }, subjects);
        await expect.poll(levels).toEqual([20 * Math.log10(0.5) + 1, -1]);
        expect((await projectTruth(page)).pcm).toEqual(beforeAudition.pcm);
        await page.getByTestId('transport-stop').click();
        await page.getByTestId('transport-undo').click();
        await expect.poll(levels).toEqual([0, 0]);
        await page.getByTestId('transport-redo').click();
        await expect.poll(levels).toEqual([20 * Math.log10(0.5) + 1, -1]);
        expect(
            await page.evaluate(async () => {
                const project: typeof import('../../src/modules/Project/useCases') =
                    await import('/src/modules/Project/useCases/index.ts');
                return project.saveProject();
            })
        ).toBe(true);
        await page.reload();
        await expect(page.getByTestId('transport-play')).toBeVisible({ timeout: 45_000 });
        await expect.poll(levels).toEqual([20 * Math.log10(0.5) + 1, -1]);
        expect((await projectTruth(page)).pcm).toEqual(beforeAudition.pcm);
        const afterReload = await page.evaluate(async () => {
            const rendering: typeof import('../../src/modules/AudioRendering/useCases') =
                await import('/src/modules/AudioRendering/useCases/index.ts');
            const transport: typeof import('../../src/modules/Transport/stores') =
                await import('/src/modules/Transport/stores/index.ts');
            return {
                retained: rendering.getAgentMeasurementArtifacts().length,
                playing: transport.transportStore.value?.isPlaying,
            };
        });
        expect(afterReload).toEqual({ retained: 0, playing: false });
        const agentTab = page.getByTestId('agent-tab-button');
        if ((await agentTab.count()) === 0) {
            await page.getByTestId('toggle-bottom-dock').click();
        }
        await agentTab.click({ timeout: 10_000 });
        const history = page.getByTestId('agent-workspace').getByRole('region', { name: 'Agent change history' });
        await expect(history).toBeVisible();
        const revert = history.getByRole('button', { name: /^Revert agent changes / });
        await expect(revert).toHaveCount(1);
        await expect(revert).toBeEnabled();
        await revert.click();
        await expect.poll(levels).toEqual([0, 0]);
        expect((await projectTruth(page)).pcm).toEqual(beforeAudition.pcm);
        expect(provider.failures).toEqual([]);
        expect(provider.requests).toHaveLength(4);
        expect(JSON.parse(provider.completionRequests[3] ?? 'null') as unknown).toMatchObject({
            tool_choice: 'required',
        });
        expect(egress).toEqual([]);
        expect(JSON.stringify(provider.requests)).not.toMatch(
            /channelData|baselineIntegratedLoudness|previewIntegratedLoudness/
        );
    } finally {
        await test.info().attach('configured-provider-wire', {
            body: JSON.stringify({ failures: provider.failures, requests: provider.requests }),
            contentType: 'application/json',
        });
        await provider.close();
    }
});

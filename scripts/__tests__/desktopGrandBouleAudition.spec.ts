// @vitest-environment node
import { runInNewContext } from 'node:vm';

import { type Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    assertBlackHoleInput,
    blackHoleCaptureAllowsHiddenDefault,
    cardDeviceId,
    driveDesktopGrandBouleAudition,
} from '../desktopGrandBouleAuditionDrive.ts';
import {
    auditionFailure,
    freshAuditionObservations,
    measureSignalWindow,
    validWindow,
    type AuditionObservations,
    type SignalWindow,
} from '../desktopGrandBouleAuditionEvidence.ts';
import {
    captureAdmissionFailure,
    captureBlackHole,
    openBlackHoleMedia,
    RECEIVE_WORKLET,
} from '../desktopGrandBouleCapture.ts';

const appBoundary = vi.hoisted(() => ({
    launchEditorSession: vi.fn(),
    readyWorkspace: vi.fn(),
    quitEditorSession: vi.fn(),
}));
const execFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:child_process')>()),
    execFileSync,
}));
vi.mock('../desktopFermenterDrive.ts', () => appBoundary);

function signal(firstFrame = 0, frames = 32768, preview = 0.01, sentinel = 0.02): SignalWindow {
    return measureSignalWindow({
        firstFrame,
        endFrame: firstFrame + frames,
        sampleRate: 48000,
        values: Array.from(
            { length: frames },
            (_, i) =>
                sentinel * Math.sin((2 * Math.PI * 220 * i) / 48000) +
                preview * Math.sin((2 * Math.PI * 261.625565 * i) / 48000)
        ),
    });
}
function complete(): AuditionObservations {
    const o = freshAuditionObservations();
    return {
        ...o,
        input: 'BlackHole 2ch',
        output: 'BlackHole 2ch',
        trackId: 'track',
        deviceId: 'piano',
        appQuit: true,
        quiet: signal(0, 32768, 0, 0),
        trials: (['held', 'release', 'close'] as const).map((kind) => ({
            kind,
            pressFrame: 32768,
            scheduled: signal(0, 32768, 0),
            positive: signal(36864),
            late: signal(69632, 98304, kind === 'held' ? 0.008 : 0.0001),
            actionFrame: 70144,
            nativeCarrier: true,
            advancing: true,
        })),
    };
}
describe('Grand Boule packaged output evidence', () => {
    it('discriminates matched held decay, ordinary release and close while sentinel continues', () => {
        expect(auditionFailure(complete())).toBeNull();
    });
    it.each(['release', 'close'] as const)('rejects a %s that remains held', (kind) => {
        const o = complete();
        o.trials.find((t) => t.kind === kind)!.late = signal(69632, 98304, 0.008);
        expect(auditionFailure(o)).toBe('preview-did-not-release');
    });
    it('rejects sentinel loss and a short drop inside an otherwise positive post-action span', () => {
        const o = complete();
        const values = Array.from({ length: 98304 }, (_, i) =>
            i >= 8192 && i < 16384 ? 0 : 0.02 * Math.sin((2 * Math.PI * 220 * i) / 48000)
        );
        o.trials[2]!.late = measureSignalWindow({ firstFrame: 69632, endFrame: 167936, sampleRate: 48000, values });
        expect(o.trials[2]!.late.sentinel).toBeGreaterThan(0.01);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
    });
    it('rejects a decayed held control and missing positive preview', () => {
        const o = complete();
        o.trials[0]!.late = signal(69632, 98304, 0);
        expect(auditionFailure(o)).toBe('held-control-decayed');
        o.trials[0]!.positive = signal(36864, 32768, 0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
    });
    it('rejects noise, absent frames, stale windows, rate drift and missing carrier', () => {
        const o = complete();
        o.quiet!.rms = 0.01;
        expect(auditionFailure(o)).toBe('quiet-baseline-invalid');
        o.quiet = signal(0, 32768, 0, 0);
        o.trials[0]!.late.firstFrame++;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[0]!.late = signal(69632, 98304, 0.008);
        o.trials[0]!.nativeCarrier = false;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[0]!.nativeCarrier = true;
        o.trials[0]!.late.sampleRate = 44100;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        expect(validWindow({ ...signal(), frames: 0 })).toBe(false);
        expect(validWindow({ ...signal(), rms: NaN })).toBe(false);
    });
    it('rejects mismatched note age and preview content already present before pressing', () => {
        const o = complete();
        o.trials[1]!.pressFrame -= 128;
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
        o.trials[1]!.pressFrame += 128;
        o.trials[1]!.scheduled = signal(0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
        o.trials[1]!.scheduled = signal(0, 32768, 0, 0);
        expect(auditionFailure(o)).toBe('positive-or-sentinel-lost');
        o.trials[1]!.scheduled = signal(128, 32768, 0);
        expect(auditionFailure(o)).toBe('clock-or-playback-invalid');
    });
    it.each([0.0001, 0.00011])(
        'rejects unchanged release at or near the measured floor with positive C4 %s',
        (amplitude) => {
            const observations = complete();
            observations.quiet!.rms = 0.00001;
            for (const trial of observations.trials) {
                trial.scheduled.preview = 0;
                trial.positive.preview = amplitude;
                trial.late.preview = trial.kind === 'held' ? amplitude : Math.min(amplitude, 0.0001);
            }
            expect(auditionFailure(observations)).toBe('preview-did-not-release');
        }
    );
    it('retains unavailable capture as no proof', () => {
        const o = complete();
        o.unavailable = 'permission-or-capture-unavailable';
        expect(auditionFailure(o)).toBe('capture-unavailable');
    });
});

type Processor = {
    port: { onmessage: ({ data }: { data: { start: number; count: number } }) => void };
    process: (input: number[][][]) => boolean;
};
function worklet() {
    const messages: { error?: string; firstFrame?: number; endFrame?: number; values?: Float32Array }[] = [];
    let processor: Processor | undefined;
    const scope = {
        currentFrame: 0,
        sampleRate: 48000,
        AudioWorkletProcessor: class {
            port = { postMessage: (data: (typeof messages)[number]) => messages.push(data) };
        },
        registerProcessor: (_name: string, Constructor: new () => Processor) => {
            processor = new Constructor();
        },
    };
    runInNewContext(RECEIVE_WORKLET, scope);
    if (!processor) {
        throw new Error('processor absent');
    }
    return {
        processor,
        scope,
        messages,
        tick: (channel = true) => {
            processor!.process(channel ? [[Array(128).fill(0.1)]] : []);
            scope.currentFrame += 128;
        },
    };
}
describe('actual bounded receive worklet', () => {
    it('returns exact historical contiguous frames without an audible output', () => {
        const w = worklet();
        w.tick();
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        for (let i = 0; i < 256; i++) {
            w.tick();
        }
        expect(w.messages[0]).toMatchObject({ firstFrame: 128, endFrame: 32896 });
        expect(w.messages[0]!.values).toHaveLength(32768);
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages[1]).toMatchObject({ firstFrame: 128, endFrame: 32896 });
    });
    it.each(['gap', 'empty'] as const)('fails closed on %s input', (kind) => {
        const w = worklet();
        w.tick();
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        if (kind === 'gap') {
            w.scope.currentFrame += 128;
        }
        w.tick(kind !== 'empty');
        expect(w.messages).toEqual([{ error: 'capture-continuity-lost' }]);
    });
    it('waits for first real input and rejects nonexistent pre-start history', () => {
        const w = worklet();
        w.processor.port.onmessage({ data: { start: 0, count: 32768 } });
        w.tick(false);
        w.scope.currentFrame = 4096;
        for (let i = 0; i < 256; i++) {
            w.tick();
        }
        expect(w.messages[0]).toMatchObject({ firstFrame: 4096, endFrame: 36864 });
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages[1]).toEqual({ error: 'capture-window-stale' });
    });
    it('refuses frames aged out of its bounded ring', () => {
        const w = worklet();
        for (let i = 0; i < 2100; i++) {
            w.tick();
        }
        w.processor.port.onmessage({ data: { start: 128, count: 32768 } });
        w.tick();
        expect(w.messages).toEqual([{ error: 'capture-window-stale' }]);
    });
});

describe('read-only BlackHole input admission', () => {
    function selector(current: string) {
        const calls: string[][] = [];
        return {
            calls,
            run(args: string[]): string {
                calls.push(args);
                if (args.length !== 3 || args.join(' ') !== '-c -t input') {
                    throw new Error('unexpected audio command');
                }
                return current;
            },
        };
    }
    it('checks the exact current input without selecting a device', () => {
        const source = selector('BlackHole 2ch');
        assertBlackHoleInput(source.run);
        expect(source.calls).toEqual([['-c', '-t', 'input']]);
    });
    it.each(['Built-in Microphone', ''])('rejects missing or drifted exact input %j', (current) => {
        const source = selector(current);
        expect(() => assertBlackHoleInput(source.run)).toThrow();
        expect(source.calls).toEqual([['-c', '-t', 'input']]);
    });
    it.each([null, 'device-card-', 'device-card-a/b', 'unrelated'])(
        'rejects absent or invalid inspector identity %s',
        (id) => {
            expect(() => cardDeviceId(id)).toThrow('missing generated Grand Boule device identity');
        }
    );
    it('narrows the exact generated inspector identity', () => {
        expect(cardDeviceId('device-card-owned-123')).toBe('owned-123');
    });
});

describe('packaged audition capture admission', () => {
    const device = 'BlackHole 2ch';

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.resetAllMocks();
    });

    it.each([
        ['local host', undefined, device, false],
        ['self-hosted runner', 'self-hosted', device, false],
        ['hosted runner with a competing input', 'github-hosted', `${device}\nBuilt-in Microphone`, false],
        ['hosted runner with only BlackHole', 'github-hosted', device, true],
    ] as const)(
        'routes concealed capture through host admission on a %s',
        async (_host, environment, inputs, allowed) => {
            vi.stubEnv('RUNNER_ENVIRONMENT', environment);
            execFileSync.mockImplementation((command: string, args: string[]) => {
                expect(command).toBe('SwitchAudioSource');
                switch (args.join(' ')) {
                    case '-c -t output':
                    case '-c -t input':
                        return `${device}\n`;
                    case '-a -t input':
                        return `${inputs}\n`;
                    default:
                        throw new Error('unexpected audio command');
                }
            });
            const getUserMedia = vi
                .fn()
                .mockRejectedValue(new DOMException('controlled capture boundary', 'NotReadableError'));
            vi.stubGlobal('navigator', {
                mediaDevices: {
                    enumerateDevices: vi
                        .fn()
                        .mockResolvedValue([{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }]),
                    getUserMedia,
                },
            });
            const page = {
                setDefaultTimeout: vi.fn(),
                getByRole: vi.fn(),
                evaluateHandle: vi.fn(
                    async (evaluate: typeof openBlackHoleMedia, options: Parameters<typeof openBlackHoleMedia>[0]) => {
                        try {
                            return await evaluate(options);
                        } catch (error) {
                            throw new Error(`page.evaluateHandle: ${String(error)}`, { cause: error });
                        }
                    }
                ),
            };
            const app = { page };
            appBoundary.launchEditorSession.mockResolvedValue(app);
            const observations = freshAuditionObservations();

            await driveDesktopGrandBouleAudition('packaged-binary', observations);

            const rawDefault: MediaStreamConstraints = {
                audio: {
                    deviceId: { exact: 'default' },
                    echoCancellation: { exact: false },
                    noiseSuppression: { exact: false },
                    autoGainControl: { exact: false },
                },
                video: false,
            };
            expect(getUserMedia.mock.calls).toEqual(allowed ? [[rawDefault]] : []);
            expect(observations.unavailable).toBe(
                allowed ? 'capture-input-NotReadableError' : 'capture-named-input-unavailable'
            );
            expect(page.evaluateHandle).toHaveBeenCalledExactlyOnceWith(openBlackHoleMedia, {
                device,
                allowHiddenDefault: allowed,
            });
            expect(appBoundary.quitEditorSession).toHaveBeenCalledExactlyOnceWith(app);
            expect(observations.appQuit).toBe(true);
        }
    );
});

describe('BlackHole renderer capture admission', () => {
    const name = 'BlackHole 2ch';
    const virtualLabel = 'BlackHole 2ch (Virtual)';

    function input(deviceId: string, label: string, groupId: string) {
        return { kind: 'audioinput', deviceId, label, groupId };
    }

    function renderer({
        before = [input('', '', '')],
        after = [
            input('default', 'Standard – BlackHole 2ch', 'virtual'),
            input('virtual-id', name, 'virtual'),
        ] as readonly ReturnType<typeof input>[],
        label = 'Standard – BlackHole 2ch',
        deviceId = 'default',
        groupId = 'virtual',
        echoCancellation = false,
    } = {}) {
        const stop = vi.fn();
        const track = {
            label,
            stop,
            getSettings: () => ({ deviceId, groupId, echoCancellation }),
        };
        const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) =>
            Promise.resolve({ getTracks: () => [track], getAudioTracks: () => [track] })
        );
        const enumerateDevices = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
        vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices, getUserMedia } });
        vi.stubGlobal('AudioContext', class {});
        return { getUserMedia, enumerateDevices, stop, track };
    }

    afterEach(() => vi.unstubAllGlobals());

    it('refuses concealed input without explicit host isolation before any media request', async () => {
        const route = renderer();

        await expect(openBlackHoleMedia({ device: name })).rejects.toThrow('capture-named-input-unavailable');
        expect(route.getUserMedia).not.toHaveBeenCalled();
    });

    function host(current = name, available = name) {
        return vi.fn((args: string[]) => {
            if (args.join(' ') === '-a -t input') {
                return available;
            }
            if (args.join(' ') === '-c -t input') {
                return current;
            }
            throw new Error('unexpected audio command');
        });
    }

    it.each([
        ['local host', '', name, [['-c', '-t', 'input']]],
        ['self-hosted runner', 'self-hosted', name, [['-c', '-t', 'input']]],
        [
            'hosted runner with a competing input',
            'github-hosted',
            `${name}\nBuilt-in Microphone`,
            [
                ['-a', '-t', 'input'],
                ['-c', '-t', 'input'],
            ],
        ],
        [
            'hosted runner with duplicate virtual inputs',
            'github-hosted',
            `${name}\n${name}`,
            [
                ['-a', '-t', 'input'],
                ['-c', '-t', 'input'],
            ],
        ],
    ] as const)(
        'refuses hidden capture on a %s before any media request',
        async (_host, environment, available, calls) => {
            const route = renderer();
            const run = host(name, available);
            const allowHiddenDefault = blackHoleCaptureAllowsHiddenDefault(run, environment);

            await expect(openBlackHoleMedia({ device: name, allowHiddenDefault })).rejects.toThrow(
                'capture-named-input-unavailable'
            );
            expect(run.mock.calls).toEqual(calls.map((args) => [args]));
            expect(route.getUserMedia).not.toHaveBeenCalled();
        }
    );

    it('checks the current input after the hosted inventory and refuses a drifted default', () => {
        const run = host('Built-in Microphone');

        expect(() => blackHoleCaptureAllowsHiddenDefault(run, 'github-hosted')).toThrow();
        expect(run.mock.calls).toEqual([[['-a', '-t', 'input']], [['-c', '-t', 'input']]]);
    });

    it.each([name, virtualLabel])('binds the hosted singleton default to the revealed %s group', async (label) => {
        const alias = `Standard – ${label}`;
        const route = renderer({
            after: [input('default', alias, 'virtual'), input('virtual-id', label, 'virtual')],
            label: alias,
        });
        const run = host();
        const allowHiddenDefault = blackHoleCaptureAllowsHiddenDefault(run, 'github-hosted');

        await expect(openBlackHoleMedia({ device: name, allowHiddenDefault })).resolves.toMatchObject({
            input: name,
            track: route.track,
        });
        expect(run.mock.calls).toEqual([[['-a', '-t', 'input']], [['-c', '-t', 'input']]]);
        expect(route.getUserMedia).toHaveBeenCalledExactlyOnceWith({
            audio: {
                deviceId: { exact: 'default' },
                echoCancellation: { exact: false },
                noiseSuppression: { exact: false },
                autoGainControl: { exact: false },
            },
            video: false,
        });
        expect(route.enumerateDevices).toHaveBeenCalledTimes(2);
        expect(route.stop).not.toHaveBeenCalled();
    });

    it.each([name, virtualLabel])(
        'pins the concrete %s identifier despite a different OS default label',
        async (label) => {
            const route = renderer({
                before: [
                    input('default', 'Default - Built-in Microphone', 'physical'),
                    input('virtual-id', label, 'virtual'),
                ],
                label,
                deviceId: 'virtual-id',
            });
            await expect(openBlackHoleMedia({ device: name })).resolves.toMatchObject({
                input: name,
                track: route.track,
            });
            expect(route.getUserMedia).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'virtual-id' } }) })
            );
            expect(route.enumerateDevices).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ['visible unrelated input', [input('built-in', 'Built-in Microphone', 'physical')]],
        ['a lookalike label', [input('lookalike', 'Other BlackHole 2ch (Virtual)', 'other')]],
        ['an extended suffix', [input('lookalike', 'BlackHole 2ch (Virtual) Extra', 'other')]],
        ['two same-named inputs', [input('left', name, 'one'), input('right', name, 'two')]],
        ['bare and decorated inputs', [input('left', name, 'one'), input('right', virtualLabel, 'two')]],
    ] as const)('rejects %s before any media request', async (_case, before) => {
        const route = renderer({ before: [...before] });
        await expect(openBlackHoleMedia({ device: name })).rejects.toThrow('capture-named-input-unavailable');
        expect(route.getUserMedia).not.toHaveBeenCalled();
    });

    it.each([
        ['a wrong device id', { label: virtualLabel, deviceId: 'other-id' }],
        ['a lookalike track label', { label: 'BlackHole 2ch (Virtual) Extra', deviceId: 'virtual-id' }],
    ] as const)('stops the concrete stream with %s', async (_case, options) => {
        const route = renderer({ ...options, before: [input('virtual-id', virtualLabel, 'virtual')] });
        await expect(openBlackHoleMedia({ device: name })).rejects.toThrow('capture-returned-input-mismatch');
        expect(route.stop).toHaveBeenCalledOnce();
    });

    it.each([
        ['a changed route', { deviceId: 'built-in' }],
        ['a returned track with the wrong group', { groupId: 'physical' }],
        ['a returned track with the wrong label', { label: 'Built-in Microphone' }],
        [
            'an alias now bound to another group',
            {
                after: [input('default', 'Standard – BlackHole 2ch', 'physical'), input('virtual-id', name, 'virtual')],
            },
        ],
        [
            'more than one revealed concrete input',
            {
                after: [
                    input('default', 'Standard – BlackHole 2ch', 'virtual'),
                    input('virtual-id', name, 'virtual'),
                    input('other-id', virtualLabel, 'other'),
                ],
            },
        ],
        ['a missing concrete input', { after: [input('default', 'Standard – BlackHole 2ch', 'virtual')] }],
    ] as const)('stops capture when there is %s', async (_case, options) => {
        const route = renderer(options);
        await expect(openBlackHoleMedia({ device: name, allowHiddenDefault: true })).rejects.toThrow(
            'capture-returned-input-mismatch'
        );
        expect(route.stop).toHaveBeenCalledOnce();
    });

    it('stops a processed stream and does not admit it as raw output evidence', async () => {
        const route = renderer({ echoCancellation: true });
        await expect(openBlackHoleMedia({ device: name, allowHiddenDefault: true })).rejects.toThrow(
            'capture-raw-input-unavailable'
        );
        expect(route.stop).toHaveBeenCalledOnce();
    });

    it.each([
        ['NotReadableError: Could not start audio source', 'capture-input-NotReadableError'],
        ['OverconstrainedError: audio constraint failed', 'capture-input-OverconstrainedError'],
        ['NotAllowedError: Permission denied', 'capture-input-NotAllowedError'],
        ['Error: capture-returned-input-mismatch', 'capture-returned-input-mismatch'],
        ['Error: permission denied while opening private renderer path', 'capture-input-failed'],
    ])('records a bounded reason for input failure %s', async (detail, code) => {
        const page = {
            evaluateHandle: vi
                .fn<Page['evaluateHandle']>()
                .mockRejectedValue(new Error(`page.evaluateHandle: ${detail}\n    at private renderer path`)),
        };
        const failure = await captureBlackHole(page, true).catch(captureAdmissionFailure);
        expect(page.evaluateHandle).toHaveBeenCalledExactlyOnceWith(openBlackHoleMedia, {
            device: name,
            allowHiddenDefault: true,
        });
        expect(failure).toBe(code);
    });
});

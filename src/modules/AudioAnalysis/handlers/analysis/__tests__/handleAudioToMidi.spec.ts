import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAudioToMidi } from '../handleAudioToMidi';
const mocks = vi.hoisted(() => ({ audioToMidi: vi.fn() }));
vi.mock('../../../useCases/audioToMidi', () => ({ audioToMidi: mocks.audioToMidi }));

describe('handleAudioToMidi', () => {
    beforeEach(() => vi.clearAllMocks());

    it('awaits conversion and forwards its normalized payload', async () => {
        let release!: (result: boolean) => void;
        mocks.audioToMidi.mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            })
        );
        let settled = false;
        const execution = Promise.resolve(
            handleAudioToMidi.execute({
                type: 'audioToMidi',
                payload: { clipId: 'c1', trackId: 't1', sensitivity: 0.8, mode: 'pitched' },
            })
        ).then((result) => {
            settled = true;
            return result;
        });
        expect(mocks.audioToMidi).toHaveBeenCalledWith({
            clipId: 'c1',
            trackId: 't1',
            sensitivity: 0.8,
            mode: 'pitched',
            signal: undefined,
        });
        expect(settled).toBe(false);
        release(true);
        expect(await execution).toEqual({ status: 'written' });
    });

    it('returns no-write for an unsuccessful conversion with defaults', async () => {
        mocks.audioToMidi.mockResolvedValue(false);
        expect(await handleAudioToMidi.execute({ type: 'audioToMidi', payload: { clipId: 'c1' } })).toEqual({
            status: 'no-write',
        });
        expect(mocks.audioToMidi).toHaveBeenCalledWith({
            clipId: 'c1',
            trackId: '',
            sensitivity: undefined,
            mode: 'rhythm',
            signal: undefined,
        });
    });

    it('passes the exact runtime cancellation signal into conversion', async () => {
        const controller = new AbortController();
        const action = { type: 'audioToMidi' as const, payload: { clipId: 'c1' } };
        mocks.audioToMidi.mockResolvedValue(false);
        await handleAudioToMidi.execute(action, { actions: [action], actionIndex: 0, signal: controller.signal });
        expect(mocks.audioToMidi).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    });

    it('leaves history and project transaction ownership with its singleton child batch', () => {
        expect(handleAudioToMidi.executionKind).toBe('runtime');
        expect(handleAudioToMidi.batchExecution).toBe('singleton');
        expect(handleAudioToMidi.undoable).toBe(false);
        expect(handleAudioToMidi.describe({ type: 'audioToMidi', payload: { clipId: 'c1' } }).label).toBe(
            'Convert audio to MIDI'
        );
    });
});

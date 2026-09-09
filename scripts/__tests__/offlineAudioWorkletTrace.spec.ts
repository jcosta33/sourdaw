import { describe, expect, it } from 'vitest';

import { admitOfflineAudioWorkletTrace } from '../offlineAudioWorkletTrace';

const outer = (ts: number, dur = 1) => ({
    name: 'AudioWorkletProcessor::Process',
    ph: 'X',
    ts,
    dur,
    pid: 1,
    tid: 2,
    args: {},
});
const handler = (ts: number, dur = 1) => ({
    name: 'AudioHandler::ProcessIfNecessary',
    ph: 'X',
    ts,
    dur,
    pid: 1,
    tid: 2,
    args: { 'node type': 'AudioWorkletNode', this: 'node' },
});
const author = (ts: number, dur = 1) => ({
    name: 'AudioWorkletProcessor::Process (author script execution)',
    ph: 'X',
    ts,
    dur,
    pid: 1,
    tid: 2,
    args: {},
});
function valid() {
    return [0, 1, 2].flatMap((i) => [handler(i * 10, 5), outer(i * 10 + 1, 3), author(i * 10 + 2, 1)]);
}
describe('offline trace admission', () => {
    it('admits complete nested trace', () => expect(admitOfflineAudioWorkletTrace(valid(), 3).status).toBe('admitted'));
    it.each([
        (e: any[]) => e.slice(3),
        (e: any[]) => e.filter((x) => x.name !== 'AudioHandler::ProcessIfNecessary'),
        (e: any[]) => [...e, outer(12, 5)],
        (e: any[]) => e.map((x) => (x.name === 'AudioWorkletProcessor::Process' ? { ...x, ts: NaN } : x)),
    ])('refuses invalid callback evidence', (mutate) =>
        expect(admitOfflineAudioWorkletTrace(mutate(valid()), 3).status).toBe('refused')
    );
});

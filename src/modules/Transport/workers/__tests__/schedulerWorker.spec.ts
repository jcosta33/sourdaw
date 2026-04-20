import fs from 'fs';
import path from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('schedulerWorker', () => {
    let workerCode: string;

    beforeEach(() => {
        const rawCode = fs.readFileSync(path.resolve(__dirname, '../schedulerWorker.ts'), 'utf-8');
        workerCode = rawCode
            .replace(/let timerId:.* = null;/, 'let timerId = null;')
            .replace(/\(e: MessageEvent\)/, '(e)')
            .replaceAll('export ', '');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('should start interval and post ticks', () => {
        const postedMessages: any[] = [];
        const selfMock = {
            onmessage: null as any,
            postMessage: (msg: any) => postedMessages.push(msg),
        };

        const executeWorker = new Function('self', 'setInterval', 'clearInterval', workerCode);
        executeWorker(selfMock, setInterval, clearInterval);

        // Simulate start message
        selfMock.onmessage({ data: { type: 'start', interval: 10 } });

        expect(postedMessages).toHaveLength(0);

        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);
        expect(postedMessages[0]).toEqual({ type: 'tick' });

        vi.advanceTimersByTime(20);
        expect(postedMessages).toHaveLength(3);
    });

    it('should stop interval on stop message', () => {
        const postedMessages: any[] = [];
        const selfMock = {
            onmessage: null as any,
            postMessage: (msg: any) => postedMessages.push(msg),
        };

        const executeWorker = new Function('self', 'setInterval', 'clearInterval', workerCode);
        executeWorker(selfMock, setInterval, clearInterval);

        selfMock.onmessage({ data: { type: 'start', interval: 10 } });

        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);

        selfMock.onmessage({ data: { type: 'stop' } });
        vi.advanceTimersByTime(50);
        expect(postedMessages).toHaveLength(1); // Should not increase
    });

    it('should restart interval if started twice', () => {
        const postedMessages: any[] = [];
        const selfMock = {
            onmessage: null as any,
            postMessage: (msg: any) => postedMessages.push(msg),
        };

        const executeWorker = new Function('self', 'setInterval', 'clearInterval', workerCode);
        executeWorker(selfMock, setInterval, clearInterval);

        selfMock.onmessage({ data: { type: 'start', interval: 10 } });
        vi.advanceTimersByTime(5);

        selfMock.onmessage({ data: { type: 'start', interval: 20 } });
        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(0); // the old 10ms is cleared, new is 20ms

        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);
    });

    it('should handle missing interval parameter', () => {
        const postedMessages: any[] = [];
        const selfMock = {
            onmessage: null as any,
            postMessage: (msg: any) => postedMessages.push(msg),
        };

        const executeWorker = new Function('self', 'setInterval', 'clearInterval', workerCode);
        executeWorker(selfMock, setInterval, clearInterval);

        selfMock.onmessage({ data: { type: 'start' } }); // Defaults to 10ms
        vi.advanceTimersByTime(10);
        expect(postedMessages).toHaveLength(1);
    });

    it('should not crash if stop is called without start', () => {
        const postedMessages: any[] = [];
        const selfMock = {
            onmessage: null as any,
            postMessage: (msg: any) => postedMessages.push(msg),
        };

        const executeWorker = new Function('self', 'setInterval', 'clearInterval', workerCode);
        executeWorker(selfMock, setInterval, clearInterval);

        selfMock.onmessage({ data: { type: 'stop' } });
        expect(postedMessages).toHaveLength(0);
    });
});

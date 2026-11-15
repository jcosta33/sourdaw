import { describe, expect, it } from 'vitest';

import { digest } from '#/utils/canonicalDigest';
import { type AppAction } from '#/utils/handlerContract';

import { type ContinuedFigure } from '../lastCommitContinuation/lastCommitOutcome';
import { readContinuationLiterals } from '../readContinuationLiterals';

function figure(overrides: Partial<ContinuedFigure> = {}): ContinuedFigure {
    return {
        deviceId: 'device-filter',
        paramId: 'cutoff',
        unit: 'Hz',
        figure: 2.5,
        comparative: 'less',
        committed: 100,
        landed: 97.5,
        ...overrides,
    };
}

function setParameter(deviceId: string, paramId: string, value: number): AppAction {
    return { type: 'setDeviceParameter', payload: { deviceId, paramId, value } };
}

describe('readContinuationLiterals', () => {
    it.each(['LUFS', 'dBTP', 'dBFS', 'Hz'])(
        'binds %s to the first exact materialized action and retains the request and figure metadata',
        (unit) => {
            const prompt = ' \n  another 2.5 units less\t ';
            const actions: AppAction[] = [
                { type: 'stopPlayback' },
                setParameter('other-device', 'cutoff', 97.5),
                setParameter('device-filter', 'cutoff', 97.5),
                setParameter('device-filter', 'cutoff', 97.5),
            ];

            expect(readContinuationLiterals(prompt, [figure({ unit })], actions)).toEqual([
                {
                    kind: 'last-commit-continuation',
                    requestDigest: digest('another 2.5 units less'),
                    actionIndex: 2,
                    unit,
                    figure: 2.5,
                    comparative: 'less',
                    committed: 100,
                    landed: 97.5,
                },
            ]);
        }
    );

    it.each(['lufs', 'DBTP', 'dbfs', 'hz', 'dB', '%', '', 'LUFS '])(
        'leaves the unsupported or differently cased unit %j unbound despite an exact action',
        (unit) => {
            expect(
                readContinuationLiterals(
                    'another 2.5',
                    [figure({ unit })],
                    [setParameter('device-filter', 'cutoff', 97.5)]
                )
            ).toEqual([]);
        }
    );

    it.each([
        { mismatch: 'device', action: setParameter('other-device', 'cutoff', 97.5) },
        { mismatch: 'parameter', action: setParameter('device-filter', 'resonance', 97.5) },
        { mismatch: 'landed value', action: setParameter('device-filter', 'cutoff', 97.500001) },
    ])('leaves a $mismatch mismatch unbound', ({ action }) => {
        expect(readContinuationLiterals('another 2.5 Hz less', [figure()], [action])).toEqual([]);
    });

    it('keeps figure order across skipped figures even when action order differs', () => {
        const actions = [setParameter('device-meter', 'target', -15), setParameter('device-filter', 'cutoff', 97.5)];
        const figures = [
            figure({ unit: 'ms' }),
            figure(),
            figure({ deviceId: 'missing-device' }),
            figure({
                deviceId: 'device-meter',
                paramId: 'target',
                unit: 'LUFS',
                figure: 1,
                comparative: 'more',
                committed: -16,
                landed: -15,
            }),
        ];

        expect(readContinuationLiterals('continue those values', figures, actions)).toEqual([
            {
                kind: 'last-commit-continuation',
                requestDigest: digest('continue those values'),
                actionIndex: 1,
                unit: 'Hz',
                figure: 2.5,
                comparative: 'less',
                committed: 100,
                landed: 97.5,
            },
            {
                kind: 'last-commit-continuation',
                requestDigest: digest('continue those values'),
                actionIndex: 0,
                unit: 'LUFS',
                figure: 1,
                comparative: 'more',
                committed: -16,
                landed: -15,
            },
        ]);
    });

    it('binds nothing when figures or materialized actions are absent', () => {
        expect(readContinuationLiterals('continue', [], [setParameter('device-filter', 'cutoff', 97.5)])).toEqual([]);
        expect(readContinuationLiterals('continue', [figure()], [])).toEqual([]);
    });
});

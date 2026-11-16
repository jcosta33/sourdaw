import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { projectTrackNames, trackNameProjectionByActionType } from '../projectTrackNames';

const rows = [
    { id: 'a', kind: 'audio', name: 'Audio 1' },
    { id: 'm', kind: 'master', name: 'Master' },
];

describe('projectTrackNames', () => {
    it('changes the planned names for exactly these actions', () => {
        const keep = trackNameProjectionByActionType.selectTrack;
        const changingEntries = Object.entries(trackNameProjectionByActionType).filter(([, entry]) => entry !== keep);
        const changing = changingEntries.map(([type]) => type).sort();
        expect(changing).toEqual(
            ['addTrack', 'createBus', 'renameTrack', 'removeTrack', 'discardCreatedTrack', 'restoreTrack'].sort()
        );
    });

    it('appends an added track under its explicit or next default name', () => {
        expect(
            projectTrackNames(rows, { type: 'addTrack', payload: { id: 'b', kind: 'audio', name: 'Drums' } })
        ).toEqual([...rows, { id: 'b', kind: 'audio', name: 'Drums' }]);
        expect(projectTrackNames(rows, { type: 'addTrack', payload: { id: 'b', kind: 'audio' } }).at(-1)?.name).toBe(
            'Audio 2'
        );
    });

    it('appends a created bus', () => {
        expect(projectTrackNames(rows, { type: 'createBus', payload: { busId: 'bus', name: 'Verb' } }).at(-1)).toEqual({
            id: 'bus',
            kind: 'bus',
            name: 'Verb',
        });
    });

    it('renames only the named track', () => {
        expect(
            projectTrackNames(rows, { type: 'renameTrack', payload: { trackId: 'a', name: 'Lead' } }).map(
                (row) => row.name
            )
        ).toEqual(['Lead', 'Master']);
    });

    it('drops a removed or discarded track but never the master', () => {
        const removals = (trackId: string): AppAction[] => [
            { type: 'removeTrack', payload: { trackId } },
            { type: 'discardCreatedTrack', payload: { trackId } },
        ];
        for (const action of removals('a')) {
            expect(projectTrackNames(rows, action).map((row) => row.id)).toEqual(['m']);
        }
        for (const action of removals('m')) {
            expect(projectTrackNames(rows, action).map((row) => row.id)).toEqual(['a', 'm']);
        }
    });

    it('leaves the names of an unrelated action alone', () => {
        expect(projectTrackNames(rows, { type: 'selectTrack', payload: { trackId: 'a' } })).toBe(rows);
    });
});

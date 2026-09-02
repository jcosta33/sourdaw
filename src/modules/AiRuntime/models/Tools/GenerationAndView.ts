import { tool, type ToolSchema } from './Types';

export const markerTools: readonly ToolSchema[] = [
    tool(
        'addMarker',
        'Add a marker at a beat position (e.g. "Chorus", "Drop").',
        {
            beat: { type: 'number' },
            name: { type: 'string', description: 'Marker label' },
        },
        ['beat', 'name']
    ),
    tool('removeMarker', 'Delete a marker.', { markerId: { type: 'string' } }, ['markerId']),
    tool(
        'addSection',
        'Define a song section (e.g. Intro, Verse, Chorus).',
        {
            startBeat: { type: 'number' },
            endBeat: { type: 'number' },
            name: { type: 'string', description: '"Intro", "Verse 1", "Chorus", "Bridge", "Outro"' },
        },
        ['startBeat', 'endBeat', 'name']
    ),
    tool('removeSection', 'Delete a section.', { sectionId: { type: 'string' } }, ['sectionId']),
    tool('renameSection', 'Rename a section.', { sectionId: { type: 'string' }, name: { type: 'string' } }, [
        'sectionId',
        'name',
    ]),
];

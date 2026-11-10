export const ordinaryProject = projectFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ordinary mix', 1_700_000_000_000);
export const predecessorProject = projectFile(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Ready predecessor',
    1_699_999_999_999
);

const retainedName = `${'A'.repeat(254)}😀Ω`;
const hostileName = `${String.fromCharCode(1)}${'A'.repeat(127)}${String.fromCharCode(159)}${'A'.repeat(127)}😀\nΩ${'tail'.repeat(2500)}`;

export const hostileProject = projectFile('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', hostileName, 1_700_000_000_001);
export const expectedHostileShellName = retainedName;

function projectFile(projectId: string, name: string, createdAt: number) {
    const data = {
        version: 2,
        meta: {
            projectId,
            name,
            createdAt,
            updatedAt: createdAt,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: {
                name: 'Equal Temperament',
                frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
            },
        },
        arrangement: { tracks: [], selectedTrackId: null },
    };
    return { data, bytes: new TextEncoder().encode(JSON.stringify(data)) };
}

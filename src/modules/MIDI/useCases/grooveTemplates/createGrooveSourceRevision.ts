type GrooveSourceRevisionNote = {
    id: string;
    startBeat: number;
    velocity: number;
};

export function createGrooveSourceRevision(notes: readonly GrooveSourceRevisionNote[]): string {
    const canonicalNotes = notes
        .map(({ id, startBeat, velocity }) => ({ id, startBeat, velocity }))
        .sort((left, right) => {
            if (left.startBeat !== right.startBeat) {
                return left.startBeat - right.startBeat;
            }
            if (left.velocity !== right.velocity) {
                return left.velocity - right.velocity;
            }
            if (left.id < right.id) {
                return -1;
            }
            if (left.id > right.id) {
                return 1;
            }
            return 0;
        });
    return JSON.stringify(canonicalNotes);
}

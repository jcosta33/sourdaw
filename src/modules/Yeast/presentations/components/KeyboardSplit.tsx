/**
 * KeyboardSplit — visual keyboard showing held/sounding notes and split zones.
 * Mini keyboard spanning C1-C7 (36-96) with color-coded zones.
 */
import { type ReactElement } from 'react';

type Props = {
    /** Notes currently held (from input). */
    heldNotes?: number[];
    /** Notes currently sounding (from arp/processor output). */
    soundingNotes?: number[];
    /** Low/high split point (MIDI note number). */
    splitPoint?: number;
    width: number;
    height: number;
};

const RANGE_LOW = 36; // C2
const RANGE_HIGH = 96; // C7
function isBlack(note: number): boolean {
    const pc = note % 12;
    return [1, 3, 6, 8, 10].includes(pc);
}

export const KeyboardSplit = ({
    heldNotes = [],
    soundingNotes = [],
    splitPoint,
    width,
    height,
}: Props): ReactElement => {
    const whiteKeys: number[] = [];
    const blackKeys: number[] = [];
    for (let n = RANGE_LOW; n < RANGE_HIGH; n++) {
        if (isBlack(n)) blackKeys.push(n);
        else whiteKeys.push(n);
    }

    const whiteKeyWidth = width / whiteKeys.length;

    // Map note → x position
    const noteToX = (note: number): number => {
        // Count white keys below this note
        let whiteCount = 0;
        for (let n = RANGE_LOW; n < note; n++) {
            if (!isBlack(n)) whiteCount++;
        }
        if (isBlack(note)) {
            return whiteCount * whiteKeyWidth - whiteKeyWidth * 0.3;
        }
        return whiteCount * whiteKeyWidth;
    };

    const heldSet = new Set(heldNotes);
    const soundingSet = new Set(soundingNotes);

    return (
        <div className="relative rounded overflow-hidden" style={{ width, height, background: '#0a0a0a' }}>
            {/* Split zone overlay */}
            {splitPoint !== undefined ? (
                <div
                    className="absolute top-0 bottom-0 opacity-10"
                    style={{
                        left: 0,
                        width: noteToX(splitPoint),
                        background: 'var(--color-accent-cyan)',
                    }}
                />
            ) : null}

            {/* White keys */}
            {whiteKeys.map((note) => {
                const x = noteToX(note);
                const held = heldSet.has(note);
                const sounding = soundingSet.has(note);
                return (
                    <div
                        key={note}
                        className="absolute bottom-0 border-r border-border/20"
                        style={{
                            left: x,
                            width: whiteKeyWidth - 1,
                            height: height,
                            background: sounding
                                ? 'var(--color-accent-peach)'
                                : held
                                  ? 'var(--color-accent-lavender)'
                                  : '#1a1a1a',
                            opacity: sounding ? 0.9 : held ? 0.7 : 1,
                            borderRadius: '0 0 2px 2px',
                        }}
                    />
                );
            })}

            {/* Black keys */}
            {blackKeys.map((note) => {
                const x = noteToX(note);
                const held = heldSet.has(note);
                const sounding = soundingSet.has(note);
                return (
                    <div
                        key={note}
                        className="absolute top-0"
                        style={{
                            left: x,
                            width: whiteKeyWidth * 0.6,
                            height: height * 0.6,
                            background: sounding
                                ? 'var(--color-accent-peach)'
                                : held
                                  ? 'var(--color-accent-lavender)'
                                  : '#0e0e0e',
                            borderRadius: '0 0 2px 2px',
                            zIndex: 1,
                        }}
                    />
                );
            })}

            {/* Octave labels */}
            {[2, 3, 4, 5, 6].map((oct) => {
                const note = oct * 12 + 12; // Cn
                if (note < RANGE_LOW || note >= RANGE_HIGH) return null;
                const x = noteToX(note);
                return (
                    <span
                        key={oct}
                        className="absolute text-[5px] text-muted-foreground/30"
                        style={{ left: x + 2, bottom: 1, zIndex: 2 }}
                    >
                        C{oct}
                    </span>
                );
            })}
        </div>
    );
};

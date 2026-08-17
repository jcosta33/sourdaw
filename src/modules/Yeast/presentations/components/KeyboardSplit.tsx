/**
 * KeyboardSplit — visual keyboard showing held and sounding notes.
 * Mini keyboard spanning C1-C7 (36-96), color-coded by note activity.
 *
 * No split-point parameter exists anywhere in the Yeast worker, so this
 * component does not render one — a `splitPoint` prop with no backing data
 * would be exactly the dead-affordance defect this component previously had.
 */
import { type ReactElement } from 'react';

type Props = {
    /** Notes currently held (from input). */
    heldNotes?: readonly number[];
    /** Notes currently sounding (from arp/processor output). */
    soundingNotes?: readonly number[];
    width: number;
    height: number;
};

const RANGE_LOW = 36; // C2
const RANGE_HIGH = 96; // C7
function isBlack(note: number): boolean {
    const pc = note % 12;
    return [1, 3, 6, 8, 10].includes(pc);
}

export const KeyboardSplit = ({ heldNotes = [], soundingNotes = [], width, height }: Props): ReactElement => {
    const whiteKeys: number[] = [];
    const blackKeys: number[] = [];
    for (let node = RANGE_LOW; node < RANGE_HIGH; node++) {
        if (isBlack(node)) {
            blackKeys.push(node);
        } else {
            whiteKeys.push(node);
        }
    }

    const whiteKeyWidth = width / whiteKeys.length;

    // Map note → x position
    const noteToX = (note: number): number => {
        // Count white keys below this note
        let whiteCount = 0;
        for (let node = RANGE_LOW; node < note; node++) {
            if (!isBlack(node)) {
                whiteCount++;
            }
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
            {/* White keys */}
            {whiteKeys.map((note) => {
                const x = noteToX(note);
                const held = heldSet.has(note);
                const sounding = soundingSet.has(note);
                const whiteKeyColor = () => {
                    if (sounding) {
                        return 'var(--color-accent-peach)';
                    }
                    if (held) {
                        return 'var(--color-accent-lavender)';
                    }
                    return '#1a1a1a';
                };
                const whiteKeyOpacity = () => {
                    if (sounding) {
                        return 0.9;
                    }
                    if (held) {
                        return 0.7;
                    }
                    return 1;
                };

                return (
                    <div
                        key={note}
                        className="absolute bottom-0 border-r border-border/20"
                        style={{
                            left: x,
                            width: whiteKeyWidth - 1,
                            height,
                            background: whiteKeyColor(),
                            opacity: whiteKeyOpacity(),
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
                const blackKeyColor = () => {
                    if (sounding) {
                        return 'var(--color-accent-peach)';
                    }
                    if (held) {
                        return 'var(--color-accent-lavender)';
                    }
                    return '#0e0e0e';
                };

                return (
                    <div
                        key={note}
                        className="absolute top-0"
                        style={{
                            left: x,
                            width: whiteKeyWidth * 0.6,
                            height: height * 0.6,
                            background: blackKeyColor(),
                            borderRadius: '0 0 2px 2px',
                            zIndex: 1,
                        }}
                    />
                );
            })}

            {/* Octave labels */}
            {[2, 3, 4, 5, 6].map((oct) => {
                const note = oct * 12 + 12; // Cn
                if (note < RANGE_LOW || note >= RANGE_HIGH) {
                    return null;
                }
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

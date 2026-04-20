import { type PointerEvent, type ReactElement, useState } from 'react';

import { cn } from '#/utils/Styles/cn';

/**
 * Interactive 88-key piano keyboard. Emits MIDI note events via the
 * `onNoteOn` / `onNoteOff` callbacks. The active note set is visually
 * highlighted. Used as the primary input for the Grand Boule panel view.
 */

const LOWEST_MIDI = 21; // A0
const HIGHEST_MIDI = 108; // C8
const NUM_KEYS = HIGHEST_MIDI - LOWEST_MIDI + 1;

// Pitch-class offsets that are black keys (C#, D#, F#, G#, A#).
const BLACK_KEY_CLASSES = new Set([1, 3, 6, 8, 10]);

const isBlackKey = (midiNote: number): boolean => BLACK_KEY_CLASSES.has(midiNote % 12);

type PianoKeyboardProps = {
    onNoteOn: (midiNote: number, velocity: number) => void;
    onNoteOff: (midiNote: number) => void;
    highlightedNotes?: ReadonlySet<number>;
    className?: string;
};

export const PianoKeyboard = ({
    onNoteOn,
    onNoteOff,
    highlightedNotes,
    className,
}: PianoKeyboardProps): ReactElement => {
    const [pressed, setPressed] = useState<number | null>(null);

    const handleDown = (midiNote: number) => (event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        (event.target as HTMLButtonElement).setPointerCapture?.(event.pointerId);
        setPressed(midiNote);
        onNoteOn(midiNote, 0.8);
    };

    const handleUp = (midiNote: number) => (event: PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (pressed === midiNote) {
            setPressed(null);
        }
        onNoteOff(midiNote);
    };

    // Render white keys first, black keys on top with absolute positioning.
    const whiteKeys: ReactElement[] = [];
    const blackKeys: ReactElement[] = [];
    let whiteIndex = 0;
    for (let offset = 0; offset < NUM_KEYS; offset += 1) {
        const midi = LOWEST_MIDI + offset;
        const isBlack = isBlackKey(midi);
        const isHighlighted = highlightedNotes?.has(midi) ?? false;
        const isPressed = pressed === midi;
        if (isBlack) {
            // Position: centred between the previous and current white key.
            blackKeys.push(
                <button
                    key={midi}
                    type="button"
                    aria-label={`MIDI ${midi}`}
                    onPointerDown={handleDown(midi)}
                    onPointerUp={handleUp(midi)}
                    onPointerCancel={handleUp(midi)}
                    className={cn(
                        'absolute top-0 h-[60%] w-[2%] rounded-b-sm border border-black',
                        'bg-zinc-900 hover:bg-zinc-700',
                        (isPressed || isHighlighted) && 'bg-neutral-500'
                    )}
                    style={{ left: `calc(${whiteIndex} * (100% / 52) - 1%)` }}
                />
            );
        } else {
            whiteKeys.push(
                <button
                    key={midi}
                    type="button"
                    aria-label={`MIDI ${midi}`}
                    onPointerDown={handleDown(midi)}
                    onPointerUp={handleUp(midi)}
                    onPointerCancel={handleUp(midi)}
                    className={cn(
                        'h-full flex-1 border-r border-zinc-300 bg-white last:border-r-0',
                        'hover:bg-zinc-100',
                        (isPressed || isHighlighted) && 'bg-neutral-300'
                    )}
                />
            );
            whiteIndex += 1;
        }
    }

    return (
        <div className={cn('relative flex h-20 w-full select-none', className)}>
            {whiteKeys}
            {blackKeys}
        </div>
    );
};

import {
    type Dispatch,
    type KeyboardEvent,
    type ReactElement,
    type SetStateAction,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { formatMidiNoteName } from '#/utils/noteNames';

import type { MidiNote } from '../../models/MidiNoteViewTypes';

const WINDOW_SIZE = 9;
const NAVIGATION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Enter', 'Escape']);
const beatNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 9, useGrouping: false });

type NoteSource = {
    clipId: string;
    notes: readonly MidiNote[];
    openedClipNotes?: Readonly<Record<string, readonly MidiNote[]>>;
    clips: ReadonlyMap<string, { name: string }>;
};

type NavigatorNote = {
    key: string;
    note: MidiNote;
    clipLabel?: string;
};

function orderedNotes({ clipId, notes, openedClipNotes, clips }: NoteSource): NavigatorNote[] {
    const sources = [[clipId, notes] as const, ...Object.entries(openedClipNotes ?? {})];
    const namedSources = sources.map(([id, clipNotes], index) => ({
        id,
        clipNotes,
        name: clips.get(id)?.name || `Clip ${index + 1}`,
    }));
    const nameCounts = new Map<string, number>();
    for (const { name } of namedSources) {
        nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }

    return namedSources
        .flatMap(({ id, clipNotes, name }, index) => {
            const clipLabel = nameCounts.get(name) === 1 ? name : `${name}, clip ${index + 1}`;
            return clipNotes.map((note) => ({
                key: JSON.stringify([id, note.id]),
                note,
                clipLabel: sources.length > 1 ? clipLabel : undefined,
            }));
        })
        .sort((a, b) => a.note.startBeat - b.note.startBeat || a.note.pitch - b.note.pitch);
}

function describeNote({ note, clipLabel }: NavigatorNote): string {
    const pitch = formatMidiNoteName(note.pitch)?.replace('#', ' sharp ') ?? `MIDI pitch ${note.pitch}`;
    const duration = `${beatNumber.format(note.duration)} ${note.duration === 1 ? 'beat' : 'beats'}`;
    return `${pitch}, starts at clip beat ${beatNumber.format(note.startBeat)}, duration ${duration}${clipLabel ? `, ${clipLabel}` : ''}`;
}

function describeSelection(notes: NavigatorNote[], selected: ReadonlySet<string>): string {
    if (notes.length === 0) {
        return 'No notes in the piano roll';
    }
    const selection = notes.filter(({ note }) => selected.has(note.id));
    const [first] = selection;
    if (!first) {
        return 'No notes selected';
    }
    if (selection.length === 1) {
        return `Selected ${describeNote(first)}`;
    }
    return `${selection.length} notes selected`;
}

type NoteCursor = { key: string; index: number };

type PianoRollNoteNavigatorProps = NoteSource & {
    id: string;
    triggerId: string;
    selectedNoteIds: ReadonlySet<string>;
    setSelectedNoteIds: Dispatch<SetStateAction<Set<string>>>;
    onDismiss: () => void;
    onEscape: () => void;
    onCommit: () => void;
};

export function PianoRollNoteNavigator({
    id,
    triggerId,
    selectedNoteIds,
    setSelectedNoteIds,
    onDismiss,
    onEscape,
    onCommit,
    ...source
}: PianoRollNoteNavigatorProps): ReactElement {
    const entries = orderedNotes(source);
    const listboxRef = useRef<HTMLDivElement>(null);
    const [cursor, setCursor] = useState<NoteCursor | null>(() => {
        const index = Math.max(
            0,
            entries.findIndex(({ note }) => selectedNoteIds.has(note.id))
        );
        const entry = entries[index];
        return entry ? { key: entry.key, index } : null;
    });
    const foundIndex = entries.findIndex(({ key }) => key === cursor?.key);
    const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(cursor?.index ?? 0, entries.length - 1);
    const active = entries[activeIndex];
    if (active && (cursor?.key !== active.key || cursor.index !== activeIndex)) {
        setCursor({ key: active.key, index: activeIndex });
    } else if (!active && cursor !== null) {
        setCursor(null);
    }

    const firstIndex = Math.max(0, Math.min(activeIndex - Math.floor(WINDOW_SIZE / 2), entries.length - WINDOW_SIZE));
    const visible = entries.slice(firstIndex, firstIndex + WINDOW_SIZE);
    const optionId = (key: string): string => `${id}-${encodeURIComponent(key)}`;
    const activeId = active ? optionId(active.key) : undefined;

    useLayoutEffect(() => {
        listboxRef.current?.focus({ preventScroll: true });
    }, []);
    useLayoutEffect(() => {
        const list = listboxRef.current;
        const option = activeId ? document.getElementById(activeId) : null;
        if (!list || !option) {
            return;
        }
        const end = option.offsetTop + option.offsetHeight;
        if (option.offsetTop < list.scrollTop) {
            list.scrollTop = option.offsetTop;
        } else if (end > list.scrollTop + list.clientHeight) {
            list.scrollTop = end - list.clientHeight;
        }
    }, [activeId, firstIndex]);

    function moveTo(index: number): void {
        const nextIndex = Math.max(0, Math.min(index, entries.length - 1));
        const entry = entries[nextIndex];
        if (entry) {
            setCursor({ key: entry.key, index: nextIndex });
        }
    }

    function toggle(noteId: string): void {
        setSelectedNoteIds((selection) => {
            const next = new Set(selection);
            if (next.has(noteId)) {
                next.delete(noteId);
            } else {
                next.add(noteId);
            }
            return next;
        });
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.nativeEvent.isComposing || event.key === 'Tab') {
            return;
        }
        event.stopPropagation();
        if (!NAVIGATION_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        switch (event.key) {
            case 'ArrowDown':
                moveTo(activeIndex + 1);
                break;
            case 'ArrowUp':
                moveTo(activeIndex - 1);
                break;
            case 'Home':
                moveTo(0);
                break;
            case 'End':
                moveTo(entries.length - 1);
                break;
            case ' ':
                if (active && !event.repeat) {
                    toggle(active.note.id);
                }
                break;
            case 'Enter':
                if (active && !event.repeat) {
                    setSelectedNoteIds(new Set([active.note.id]));
                    onCommit();
                }
                break;
            case 'Escape':
                onEscape();
                break;
        }
    }

    return (
        <div
            id={id}
            role="dialog"
            aria-labelledby={triggerId}
            className="daw-floating-surface absolute top-0 right-0 z-20 flex max-h-full w-96 max-w-full flex-col overflow-hidden rounded-md p-2 text-sm"
            onBlur={(event) => {
                if (event.relatedTarget?.id !== triggerId && !event.currentTarget.contains(event.relatedTarget)) {
                    onDismiss();
                }
            }}
        >
            <p id={`${id}-help`} className="sr-only">
                Arrows, Home and End browse. Space toggles selection. Enter selects the current note and returns to the
                editor. Escape closes.
            </p>
            <div
                ref={listboxRef}
                role="listbox"
                aria-label="Piano roll notes"
                aria-multiselectable="true"
                aria-describedby={`${id}-help`}
                aria-activedescendant={activeId}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onClick={(event) => {
                    const target = event.target;
                    const offset = visible.findIndex(
                        ({ key }) => target instanceof Element && target.id === optionId(key)
                    );
                    const entry = visible[offset];
                    if (entry) {
                        moveTo(firstIndex + offset);
                        toggle(entry.note.id);
                    }
                }}
                className="relative min-h-6 overflow-auto rounded border border-border p-1 outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
                {visible.map((entry, offset) => (
                    <div
                        key={entry.key}
                        id={optionId(entry.key)}
                        role="option"
                        aria-selected={selectedNoteIds.has(entry.note.id)}
                        aria-posinset={firstIndex + offset + 1}
                        aria-setsize={entries.length}
                        data-active={entry.key === active?.key}
                        className="cursor-pointer truncate rounded px-2 py-1 hover:bg-accent aria-selected:font-semibold aria-selected:text-accent-primary data-[active=true]:bg-accent"
                    >
                        {describeNote(entry)}
                    </div>
                ))}
            </div>
            <p role="status" aria-atomic="true" className="mt-1 truncate text-xs text-muted-foreground">
                {describeSelection(entries, selectedNoteIds)}
            </p>
        </div>
    );
}

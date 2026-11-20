import {
    type Dispatch,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
    type RefObject,
    type SetStateAction,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

import { Grid, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { formatMidiNoteName } from '#/utils/noteNames';

import type { MidiNote } from '../../../models/MidiNoteViewTypes';

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

type NoteSelection = {
    selectedNoteIds: ReadonlySet<string>;
    setSelectedNoteIds: Dispatch<SetStateAction<Set<string>>>;
};

type NoteNavigatorProps = NoteSource &
    NoteSelection & {
        canvasRef: RefObject<HTMLCanvasElement | null>;
        toolbar: ReactNode;
        contextMenu: ReactNode;
        children: ReactNode;
    };

export function PianoRollNoteNavigator({
    canvasRef,
    toolbar,
    contextMenu,
    children,
    selectedNoteIds,
    setSelectedNoteIds,
    ...source
}: NoteNavigatorProps): ReactElement {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const triggerId = `${id}-trigger`;

    return (
        <Grid className="min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
            {toolbar}
            <Button
                id={triggerId}
                ref={triggerRef}
                type="button"
                size="xs"
                variant={open ? 'secondary' : 'ghost'}
                className="mr-2 self-center"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => setOpen((current) => !current)}
            >
                Note navigator
            </Button>
            <Stack className="relative col-span-2 min-h-0 overflow-hidden">
                {open ? (
                    <PianoRollNoteList
                        id={id}
                        triggerId={triggerId}
                        entries={orderedNotes(source)}
                        selectedNoteIds={selectedNoteIds}
                        setSelectedNoteIds={setSelectedNoteIds}
                        onDismiss={() => setOpen(false)}
                        onEscape={() => {
                            setOpen(false);
                            triggerRef.current?.focus({ preventScroll: true });
                        }}
                        onCommit={() => {
                            setOpen(false);
                            canvasRef.current?.focus({ preventScroll: true });
                        }}
                    />
                ) : null}
                {children}
            </Stack>
            {contextMenu}
        </Grid>
    );
}

type NoteListboxProps = NoteSelection & {
    id: string;
    entries: NavigatorNote[];
    onEscape: () => void;
    onCommit: () => void;
};

type NoteListProps = NoteListboxProps & {
    triggerId: string;
    onDismiss: () => void;
};

function PianoRollNoteList({ triggerId, onDismiss, ...listbox }: NoteListProps): ReactElement {
    const { id, entries, selectedNoteIds } = listbox;
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
            <PianoRollNoteListbox {...listbox} />
            <p role="status" aria-atomic="true" className="mt-1 truncate text-xs text-muted-foreground">
                {describeSelection(entries, selectedNoteIds)}
            </p>
        </div>
    );
}

type NoteCursor = { key: string; index: number };

function useNoteCursor(entries: NavigatorNote[], selectedNoteIds: ReadonlySet<string>) {
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

    function moveTo(index: number): void {
        const nextIndex = Math.max(0, Math.min(index, entries.length - 1));
        const entry = entries[nextIndex];
        if (entry) {
            setCursor({ key: entry.key, index: nextIndex });
        }
    }

    return { active, activeIndex, moveTo };
}

function browseIndex(key: string, activeIndex: number, noteCount: number): number | undefined {
    switch (key) {
        case 'ArrowDown':
            return activeIndex + 1;
        case 'ArrowUp':
            return activeIndex - 1;
        case 'Home':
            return 0;
        case 'End':
            return noteCount - 1;
        default:
            return undefined;
    }
}

function useNoteListbox({ id, entries, selectedNoteIds, setSelectedNoteIds, onEscape, onCommit }: NoteListboxProps) {
    const { active, activeIndex, moveTo } = useNoteCursor(entries, selectedNoteIds);
    const firstIndex = Math.max(0, Math.min(activeIndex - Math.floor(WINDOW_SIZE / 2), entries.length - WINDOW_SIZE));
    const visible = entries.slice(firstIndex, firstIndex + WINDOW_SIZE);
    const optionId = (key: string): string => `${id}-${encodeURIComponent(key)}`;
    const activeId = active ? optionId(active.key) : undefined;

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
        const nextIndex = browseIndex(event.key, activeIndex, entries.length);
        if (nextIndex !== undefined) {
            moveTo(nextIndex);
            return;
        }
        if (event.key === 'Escape') {
            onEscape();
            return;
        }
        if (!active || event.repeat) {
            return;
        }
        if (event.key === ' ') {
            toggle(active.note.id);
        } else {
            setSelectedNoteIds(new Set([active.note.id]));
            onCommit();
        }
    }

    function handleClick(event: MouseEvent<HTMLDivElement>): void {
        const target = event.target;
        const offset = visible.findIndex(({ key }) => target instanceof Element && target.id === optionId(key));
        const entry = visible[offset];
        if (entry) {
            moveTo(firstIndex + offset);
            toggle(entry.note.id);
        }
    }

    return { active, activeId, firstIndex, visible, optionId, handleKeyDown, handleClick };
}

function useFocusedNoteListbox(activeId: string | undefined, firstIndex: number): RefObject<HTMLDivElement | null> {
    const listboxRef = useRef<HTMLDivElement>(null);
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
    return listboxRef;
}

function PianoRollNoteListbox(props: NoteListboxProps): ReactElement {
    const { id, entries, selectedNoteIds } = props;
    const { active, activeId, firstIndex, visible, optionId, handleKeyDown, handleClick } = useNoteListbox(props);
    const listboxRef = useFocusedNoteListbox(activeId, firstIndex);

    return (
        <div
            ref={listboxRef}
            role="listbox"
            aria-label="Piano roll notes"
            aria-multiselectable="true"
            aria-describedby={`${id}-help`}
            aria-activedescendant={activeId}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
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
    );
}

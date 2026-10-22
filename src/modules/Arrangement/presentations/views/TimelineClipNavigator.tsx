import {
    type KeyboardEvent,
    type ReactElement,
    type RefObject,
    useEffect,
    useId,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';

import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { trackStore } from '../../stores/trackStore';
import { selectClipWithFocus } from '../../useCases/clipSelection/selectClipWithFocus';
import { setClipSelection } from '../../useCases/clipSelection/setClipSelection';
import { getTimelineClipNavigationSnapshot } from '../../useCases/getTimelineClipNavigationSnapshot';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';

type TimelineClip = ReturnType<typeof getTimelineClipNavigationSnapshot>[number];

function describeClip(item: TimelineClip): string {
    const { clip, track } = item;
    return `${clip.name}, ${track.name}, ${clip.type === 'midi' ? 'MIDI' : 'audio'} clip, start beat ${clip.startBeat}, end beat ${clip.endBeat}`;
}

function selectedClipIds(selection: typeof defaultClipSelectionState): string[] {
    const ids = new Set(selection.selectedClipIds);
    if (selection.selectedClipId) {
        ids.add(selection.selectedClipId);
    }
    return [...ids];
}

function selectionStatus(ids: string[], focused: TimelineClip | undefined): string {
    if (ids.length === 0) {
        return 'No clips selected';
    }
    if (ids.length === 1) {
        return `Selected ${focused ? describeClip(focused) : 'one clip'}`;
    }
    return `${ids.length} clips selected${focused ? `; focused ${describeClip(focused)}` : ''}`;
}

export function TimelineClipNavigator({ onClose }: { onClose: () => void }): ReactElement {
    const clips = useSyncExternalStore(trackStore.subscribeReact, getTimelineClipNavigationSnapshot);
    const selection = useSyncExternalStore(
        clipSelectionStore.subscribeReact,
        () => clipSelectionStore.getSnapshot() ?? defaultClipSelectionState
    );
    const listboxRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const [activeKey, setActiveKey] = useState<string | null>(() => {
        const selected = new Set(selectedClipIds(selection));
        return clips.find((item) => selected.has(item.clip.id))?.key ?? clips[0]?.key ?? null;
    });
    const lastIndex = useRef(0);
    const foundIndex = clips.findIndex((item) => item.key === activeKey);
    const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(lastIndex.current, clips.length - 1);
    const active = clips[activeIndex];
    const first = Math.max(0, activeIndex - 4);
    const visible = clips.slice(first, first + 9);
    const selectedIds = selectedClipIds(selection);
    const selected = new Set(selectedIds);
    const focused = clips.find((item) => item.clip.id === selection.selectedClipId);
    const status = selectionStatus(selectedIds, focused);

    useEffect(() => {
        listboxRef.current?.focus();
    }, []);

    useEffect(() => {
        if (active && active.key !== activeKey) {
            setActiveKey(active.key);
        } else if (!active && activeKey !== null) {
            setActiveKey(null);
        }
    }, [active, activeKey]);

    function moveTo(index: number): void {
        const next = clips[index];
        if (!next) {
            return;
        }
        lastIndex.current = index;
        setActiveKey(next.key);
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
        const claimed = ['ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Spacebar', 'Enter', 'Escape'];
        if (!claimed.includes(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        switch (event.key) {
            case 'ArrowDown':
                moveTo(Math.min(activeIndex + 1, clips.length - 1));
                break;
            case 'ArrowUp':
                moveTo(Math.max(activeIndex - 1, 0));
                break;
            case 'Home':
                moveTo(0);
                break;
            case 'End':
                moveTo(clips.length - 1);
                break;
            case ' ':
            case 'Spacebar':
                if (active) {
                    if (selected.has(active.clip.id)) {
                        setClipSelection(selectedIds.filter((clipId) => clipId !== active.clip.id));
                    } else {
                        setClipSelection([...selectedIds, active.clip.id]);
                    }
                }
                break;
            case 'Enter':
                if (active) {
                    selectTrack(active.track.id);
                    selectClipWithFocus(active.clip.id);
                }
                break;
            case 'Escape':
                onClose();
                break;
        }
    }

    return (
        <TimelineClipNavigatorView
            id={id}
            listboxRef={listboxRef}
            onKeyDown={handleKeyDown}
            active={active}
            first={first}
            visible={visible}
            selected={selected}
            total={clips.length}
            status={status}
        />
    );
}

type TimelineClipNavigatorViewProps = {
    readonly id: string;
    readonly listboxRef: RefObject<HTMLDivElement | null>;
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    readonly active: TimelineClip | undefined;
    readonly first: number;
    readonly visible: readonly TimelineClip[];
    readonly selected: ReadonlySet<string>;
    readonly total: number;
    readonly status: string;
};

function TimelineClipNavigatorView({
    id,
    listboxRef,
    onKeyDown,
    active,
    first,
    visible,
    selected,
    total,
    status,
}: TimelineClipNavigatorViewProps): ReactElement {
    return (
        <div className="max-w-sm rounded border border-border bg-surface-base p-2 text-sm shadow-lg">
            <p id={`${id}-help`} className="mb-2 text-foreground/70">
                Arrow keys, Home and End browse clips. Space toggles selection; Enter selects one clip. Escape closes.
            </p>
            <div
                ref={listboxRef}
                role="listbox"
                aria-label="Timeline clips"
                aria-multiselectable="true"
                aria-describedby={`${id}-help`}
                aria-activedescendant={active ? `${id}-${active.key}` : undefined}
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="max-h-64 overflow-auto rounded border border-border p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                {total === 0 ? <p>No clips</p> : null}
                {visible.map((item, offset) => (
                    <div
                        key={item.key}
                        id={`${id}-${item.key}`}
                        role="option"
                        aria-label={describeClip(item)}
                        aria-selected={selected.has(item.clip.id)}
                        aria-posinset={first + offset + 1}
                        aria-setsize={total}
                        className={item.key === active?.key ? 'rounded bg-primary/20 px-2 py-1' : 'px-2 py-1'}
                    >
                        {item.clip.name} · {item.track.name}
                    </div>
                ))}
            </div>
            <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-foreground/70">
                {status}
            </p>
        </div>
    );
}

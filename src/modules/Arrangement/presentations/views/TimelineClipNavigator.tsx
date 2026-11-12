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

import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';

import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { trackStore } from '../../stores/trackStore';
import { selectClipWithFocus } from '../../useCases/clipSelection/selectClipWithFocus';
import { getTimelineClipNavigationSnapshot } from '../../useCases/getTimelineClipNavigationSnapshot';
import { revealTimelineClip } from '../../useCases/revealTimelineClip';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';

import { getTimelineClipNavigatorKeyboardHandlers } from './timelineClipNavigatorKeyboard';
import { type ClipTypeFilter, filterTimelineClips, type TimelineClip } from './timelineClipNavigatorModel';

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
    const selectedTrackId = useSyncExternalStore(
        trackStore.subscribeReact,
        () => trackStore.getSnapshot()?.selectedTrackId ?? null
    );
    const selection = useSyncExternalStore(
        clipSelectionStore.subscribeReact,
        () => clipSelectionStore.getSnapshot() ?? defaultClipSelectionState
    );
    const searchRef = useRef<HTMLInputElement>(null);
    const listboxRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const [query, setQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<ClipTypeFilter>('all');
    const [currentTrackOnly, setCurrentTrackOnly] = useState(false);
    const [activeClipId, setActiveClipId] = useState<string | null>(() => {
        const selected = new Set(selectedClipIds(selection));
        return clips.find((item) => selected.has(item.clip.id))?.clip.id ?? clips[0]?.clip.id ?? null;
    });
    const filteredClips = filterTimelineClips(clips, query, typeFilter, currentTrackOnly, selectedTrackId);
    const lastIndex = useRef(0);
    const foundIndex = filteredClips.findIndex((item) => item.clip.id === activeClipId);
    const activeIndex = foundIndex >= 0 ? foundIndex : Math.min(lastIndex.current, filteredClips.length - 1);
    const active = filteredClips[activeIndex];
    const first = Math.max(0, activeIndex - 4);
    const visible = filteredClips.slice(first, first + 9);
    const selectedIds = selectedClipIds(selection);
    const selected = new Set(selectedIds);
    const focused = clips.find((item) => item.clip.id === selection.selectedClipId);
    const status = selectionStatus(selectedIds, focused);

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    useEffect(() => {
        if (active) {
            lastIndex.current = activeIndex;
            if (active.clip.id !== activeClipId) {
                setActiveClipId(active.clip.id);
            }
        } else if (activeClipId !== null) {
            setActiveClipId(null);
        }
    }, [active, activeClipId, activeIndex]);

    function moveTo(index: number): void {
        const next = filteredClips[index];
        if (!next) {
            return;
        }
        lastIndex.current = index;
        setActiveClipId(next.clip.id);
    }

    function commitActive(): void {
        if (!active) {
            return;
        }
        selectTrack(active.track.id);
        selectClipWithFocus(active.clip.id);
        revealTimelineClip(active.clip.id);
    }

    const { handleKeyDown, handleSearchKeyDown } = getTimelineClipNavigatorKeyboardHandlers({
        active,
        activeIndex,
        filteredClips,
        selected,
        selectedIds,
        listboxRef,
        moveTo,
        commitActive,
        onClose,
    });

    return (
        <TimelineClipNavigatorView
            id={id}
            searchRef={searchRef}
            listboxRef={listboxRef}
            query={query}
            onQueryChange={setQuery}
            onSearchKeyDown={handleSearchKeyDown}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            currentTrackOnly={currentTrackOnly}
            currentTrackAvailable={selectedTrackId !== null}
            onCurrentTrackOnlyChange={setCurrentTrackOnly}
            onKeyDown={handleKeyDown}
            active={active}
            first={first}
            visible={visible}
            selected={selected}
            total={filteredClips.length}
            unfilteredTotal={clips.length}
            status={status}
        />
    );
}

type TimelineClipNavigatorViewProps = {
    readonly id: string;
    readonly searchRef: RefObject<HTMLInputElement | null>;
    readonly listboxRef: RefObject<HTMLDivElement | null>;
    readonly query: string;
    readonly onQueryChange: (query: string) => void;
    readonly onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    readonly typeFilter: ClipTypeFilter;
    readonly onTypeFilterChange: (filter: ClipTypeFilter) => void;
    readonly currentTrackOnly: boolean;
    readonly currentTrackAvailable: boolean;
    readonly onCurrentTrackOnlyChange: (enabled: boolean) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    readonly active: TimelineClip | undefined;
    readonly first: number;
    readonly visible: readonly TimelineClip[];
    readonly selected: ReadonlySet<string>;
    readonly total: number;
    readonly unfilteredTotal: number;
    readonly status: string;
};

type TimelineClipNavigatorFiltersProps = Pick<
    TimelineClipNavigatorViewProps,
    'typeFilter' | 'onTypeFilterChange' | 'currentTrackOnly' | 'currentTrackAvailable' | 'onCurrentTrackOnlyChange'
>;

function TimelineClipNavigatorFilters({
    typeFilter,
    onTypeFilterChange,
    currentTrackOnly,
    currentTrackAvailable,
    onCurrentTrackOnlyChange,
}: TimelineClipNavigatorFiltersProps): ReactElement {
    const filters: readonly { value: ClipTypeFilter; label: string }[] = [
        { value: 'all', label: 'All' },
        { value: 'midi', label: 'MIDI' },
        { value: 'audio', label: 'Audio' },
    ];
    return (
        <div role="group" aria-label="Clip filters" className="mb-2 flex flex-wrap gap-1">
            {filters.map((filter) => (
                <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    variant={typeFilter === filter.value ? 'secondary' : 'ghost'}
                    aria-pressed={typeFilter === filter.value}
                    onClick={() => onTypeFilterChange(filter.value)}
                >
                    {filter.label}
                </Button>
            ))}
            <Button
                type="button"
                size="sm"
                variant={currentTrackOnly ? 'secondary' : 'ghost'}
                aria-pressed={currentTrackOnly}
                disabled={!currentTrackAvailable}
                onClick={() => onCurrentTrackOnlyChange(!currentTrackOnly)}
            >
                Current track
            </Button>
        </div>
    );
}

function TimelineClipNavigatorView({
    id,
    searchRef,
    listboxRef,
    query,
    onQueryChange,
    onSearchKeyDown,
    typeFilter,
    onTypeFilterChange,
    currentTrackOnly,
    currentTrackAvailable,
    onCurrentTrackOnlyChange,
    onKeyDown,
    active,
    first,
    visible,
    selected,
    total,
    unfilteredTotal,
    status,
}: TimelineClipNavigatorViewProps): ReactElement {
    return (
        <div className="max-w-sm rounded border border-border bg-surface-base p-2 text-sm shadow-lg">
            <Input
                ref={searchRef}
                type="search"
                aria-label="Search clips"
                aria-controls={`${id}-listbox`}
                aria-describedby={`${id}-help ${id}-count`}
                placeholder="Search clip or track names"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={onSearchKeyDown}
                className="mb-2"
                autoComplete="off"
            />
            <TimelineClipNavigatorFilters
                typeFilter={typeFilter}
                onTypeFilterChange={onTypeFilterChange}
                currentTrackOnly={currentTrackOnly}
                currentTrackAvailable={currentTrackAvailable}
                onCurrentTrackOnlyChange={onCurrentTrackOnlyChange}
            />
            <p id={`${id}-help`} className="mb-2 text-foreground/70">
                Type to filter. Arrow Down enters results; arrows, Home and End browse. Space toggles selection; Enter
                selects and reveals. Escape closes.
            </p>
            <p id={`${id}-count`} aria-live="polite" aria-atomic="true" className="mb-1 text-xs text-foreground/70">
                {total} of {unfilteredTotal} clips
            </p>
            <div
                id={`${id}-listbox`}
                ref={listboxRef}
                role="listbox"
                aria-label="Timeline clips"
                aria-multiselectable="true"
                aria-describedby={`${id}-help ${id}-count`}
                aria-activedescendant={active ? `${id}-${active.key}` : undefined}
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="max-h-64 overflow-auto rounded border border-border p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                {unfilteredTotal === 0 ? <p>No clips</p> : null}
                {unfilteredTotal > 0 && total === 0 ? <p>No matching clips</p> : null}
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

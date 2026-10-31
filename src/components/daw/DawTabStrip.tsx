import {
    type ComponentType,
    type KeyboardEvent,
    type ReactElement,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

export type DawTabStripItem<TId extends string> = {
    id: TId;
    label: string;
    icon?: ComponentType<{ className?: string }>;
    /** Classes applied to this tab in every state. */
    className?: string;
    /** Classes applied while this tab is the selected one. */
    activeClassName?: string;
    /** Extra attributes for the tab element, such as `data-testid` or `data-onboarding` hooks. */
    attributes?: Record<string, string>;
};

type DawTabStripProps<TId extends string> = {
    /** Accessible name of the tablist. */
    label: string;
    /** Prefix of every tab's DOM id; see `getDawTabId`. */
    idPrefix: string;
    items: readonly DawTabStripItem<TId>[];
    activeId: TId;
    onChange: (id: TId) => void;
    /** DOM id of the tabpanel the tabs control; `aria-controls` is omitted without one. */
    panelId?: string;
    className?: string;
    scrollerClassName?: string;
    tabClassName?: string;
};

/** Width of the edge fade; a revealed tab is kept clear of it. */
const EDGE_FADE_PX = 24;
const SCROLL_STEP_PX = 80;
const EDGE_EPSILON_PX = 1;

const ARROW_STEPS: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
};

/** The DOM id a tab receives, for a panel's `aria-labelledby`. */
export const getDawTabId = (idPrefix: string, id: string): string => `${idPrefix}-${id}`;

const targetIndexForKey = (key: string, currentIndex: number, count: number): number | undefined => {
    if (key === 'Home') {
        return 0;
    }
    if (key === 'End') {
        return count - 1;
    }
    const step = ARROW_STEPS[key];
    if (step === undefined) {
        return undefined;
    }
    return (currentIndex + step + count) % count;
};

// Scrolls only this strip. `scrollIntoView` would also scroll every ancestor that clips the tab.
// The browser clamps the assignment, so the first and last tab never overshoot.
const revealTab = (scroller: HTMLElement, tab: HTMLElement): void => {
    const scrollerBox = scroller.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const hiddenLeft = scrollerBox.left + EDGE_FADE_PX - tabBox.left;
    if (hiddenLeft > 0) {
        scroller.scrollLeft -= hiddenLeft;
        return;
    }
    const hiddenRight = tabBox.right - (scrollerBox.right - EDGE_FADE_PX);
    if (hiddenRight > 0) {
        scroller.scrollLeft += hiddenRight;
    }
};

type ScrollEdges = { canScrollLeft: boolean; canScrollRight: boolean };

// Tracks whether more content exists on either side of the scroller. `itemKey` re-subscribes when the
// tab set changes, because a ResizeObserver on the scroller does not see its content grow.
const useScrollEdges = (scrollRef: RefObject<HTMLDivElement | null>, itemKey: string): ScrollEdges => {
    const [edges, setEdges] = useState<ScrollEdges>({ canScrollLeft: false, canScrollRight: false });

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) {
            return undefined;
        }

        let frame = 0;
        const updateScrollState = () => {
            const overflow = element.scrollWidth - element.clientWidth;
            setEdges({
                canScrollLeft: element.scrollLeft > EDGE_EPSILON_PX,
                canScrollRight: overflow > EDGE_EPSILON_PX && element.scrollLeft < overflow - EDGE_EPSILON_PX,
            });
        };
        const scheduleUpdate = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(updateScrollState);
        };

        scheduleUpdate();
        element.addEventListener('scroll', scheduleUpdate, { passive: true });
        const observer = new ResizeObserver(scheduleUpdate);
        observer.observe(element);

        return () => {
            cancelAnimationFrame(frame);
            element.removeEventListener('scroll', scheduleUpdate);
            observer.disconnect();
        };
    }, [scrollRef, itemKey]);

    return edges;
};

const useRevealSelectedTab = (scrollRef: RefObject<HTMLDivElement | null>, activeId: string, itemKey: string): void => {
    useEffect(() => {
        const scroller = scrollRef.current;
        const selected = scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        if (scroller && selected) {
            revealTab(scroller, selected);
        }
    }, [scrollRef, activeId, itemKey]);
};

type ScrollEdgeButtonProps = {
    direction: 'left' | 'right';
    visible: boolean;
    onScroll: () => void;
};

const ScrollEdgeButton = ({ direction, visible, onScroll }: ScrollEdgeButtonProps): ReactElement => {
    const Chevron = direction === 'left' ? ChevronLeft : ChevronRight;
    return (
        <Button
            variant="bare"
            size="bare"
            type="button"
            className={cn(
                'absolute inset-y-0 z-10 flex w-6 items-center justify-center from-surface-base/90 to-transparent transition-opacity',
                direction === 'left' ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l',
                visible ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            onClick={onScroll}
            aria-label={`Scroll tabs ${direction}`}
            tabIndex={visible ? 0 : -1}
        >
            <Chevron className="size-3 text-muted-foreground" strokeWidth={2.5} aria-hidden="true" />
        </Button>
    );
};

// WAI-ARIA Tabs pattern with manual activation: arrows, Home and End move focus only, and Enter or
// Space (the button's own click) selects. Selecting a dock or sidebar tab mounts a heavy panel and
// can resize the dock, so arrowing across the strip must not switch panels on every keystroke.
export const DawTabStrip = <TId extends string>({
    label,
    idPrefix,
    items,
    activeId,
    onChange,
    panelId,
    className,
    scrollerClassName,
    tabClassName,
}: DawTabStripProps<TId>): ReactElement => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const tabStopId = items.some((item) => item.id === activeId) ? activeId : items[0]?.id;
    const itemKey = items.map((item) => item.id).join('\n');
    const { canScrollLeft, canScrollRight } = useScrollEdges(scrollRef, itemKey);
    useRevealSelectedTab(scrollRef, activeId, itemKey);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
        const currentIndex = tabs.findIndex((tab) => tab === event.target);
        if (currentIndex === -1) {
            return;
        }
        const nextIndex = targetIndexForKey(event.key, currentIndex, tabs.length);
        if (nextIndex === undefined) {
            return;
        }
        event.preventDefault();
        tabs[nextIndex]?.focus();
    };

    return (
        <div className={cn('relative min-w-0', className)}>
            <div
                ref={scrollRef}
                role="tablist"
                aria-label={label}
                className={cn('flex gap-0.5 overflow-x-auto scrollbar-none', scrollerClassName)}
                onKeyDown={handleKeyDown}
            >
                {items.map((item) => {
                    const Icon = item.icon;
                    const selected = item.id === activeId;
                    return (
                        <Button
                            key={item.id}
                            type="button"
                            role="tab"
                            id={getDawTabId(idPrefix, item.id)}
                            aria-selected={selected}
                            aria-controls={panelId}
                            tabIndex={item.id === tabStopId ? 0 : -1}
                            variant={selected ? 'secondary' : 'ghost'}
                            size="xs"
                            className={cn(tabClassName, item.className, selected ? item.activeClassName : undefined)}
                            onClick={() => onChange(item.id)}
                            {...item.attributes}
                        >
                            {Icon ? <Icon className="size-3" /> : null}
                            {item.label}
                        </Button>
                    );
                })}
            </div>

            <ScrollEdgeButton
                direction="left"
                visible={canScrollLeft}
                onScroll={() => scrollRef.current?.scrollBy({ left: -SCROLL_STEP_PX, behavior: 'smooth' })}
            />
            <ScrollEdgeButton
                direction="right"
                visible={canScrollRight}
                onScroll={() => scrollRef.current?.scrollBy({ left: SCROLL_STEP_PX, behavior: 'smooth' })}
            />
        </div>
    );
};

import {
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from 'react';

import { DawContextMenuSurface } from '#/components/daw/DawContextMenuSurface';
import { DawMenuButton } from '#/components/daw/DawMenuParts';
import { Fader } from '#/components/daw/Fader';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { defaultTransportState } from '#/modules/Transport/useCases';
import { FADER_MAX_GAIN, formatGainDb, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { promptUser } from '#/utils/Notification/promptUser';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { parseMasterGainEntry } from './parseMasterGainEntry';

type MasterGainControlProps = {
    value: number;
    onChange: (value: number, isTransient?: boolean) => void;
    onEnterValue: (value: number) => void;
    onResetToDefault: () => void;
    onCopyValue: () => void;
    onPasteValue: () => void;
    onInvalidatePendingValue: () => void;
};

type MasterGainMenuProps = {
    position: { x: number; y: number };
    menuRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onReset: () => void;
    onEnterValue: () => void;
    onCopyValue: () => void;
    onPasteValue: () => void;
};

type MasterGainFaderProps = Pick<MasterGainControlProps, 'value' | 'onChange'>;

function useMasterGainPromptFocus(controlRef: RefObject<HTMLDivElement | null>) {
    const latestPrompt = useRef(0);
    const mounted = useRef(false);
    const focusFrame = useRef<number | null>(null);
    const invalidatePrompt = (): void => {
        latestPrompt.current += 1;
        if (focusFrame.current !== null) {
            window.cancelAnimationFrame(focusFrame.current);
            focusFrame.current = null;
        }
    };
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            latestPrompt.current += 1;
            if (focusFrame.current !== null) {
                window.cancelAnimationFrame(focusFrame.current);
                focusFrame.current = null;
            }
        };
    }, []);
    const restoreFocus = (request: number, authority: ReturnType<typeof captureProjectTransitionAuthority>): void => {
        focusFrame.current = window.requestAnimationFrame(() => {
            focusFrame.current = null;
            if (
                mounted.current &&
                request === latestPrompt.current &&
                authority.isCurrent() &&
                document.activeElement === document.body
            ) {
                controlRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
            }
        });
    };
    return { latestPrompt, mounted, invalidatePrompt, restoreFocus };
}

const MasterGainFader = ({ value, onChange }: MasterGainFaderProps): ReactElement => (
    <Fader
        value={value}
        onChange={onChange}
        min={0}
        max={FADER_MAX_GAIN}
        valueScale="gain"
        unityValue={1}
        step={0.01}
        fineStep={0.001}
        defaultValue={defaultTransportState.masterGain / 100}
        height={100}
        aria-label="Master gain"
    />
);

const MasterGainMenu = ({
    position,
    menuRef,
    onClose,
    onReset,
    onEnterValue,
    onCopyValue,
    onPasteValue,
}: MasterGainMenuProps): ReactElement => {
    useEffect(() => {
        menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }, [menuRef]);

    const handleNavigationKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            return;
        }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        if (items.length === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = items.findIndex((item) => item === document.activeElement);
        let nextIndex: number;
        if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = items.length - 1;
        } else {
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            nextIndex = (currentIndex + direction + items.length) % items.length;
        }
        items[nextIndex]?.focus();
    };

    return (
        <DawContextMenuSurface
            ref={menuRef}
            role="menu"
            aria-label="Master gain actions"
            x={position.x}
            y={position.y}
            onClose={onClose}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleNavigationKeyDown}
        >
            <DawMenuButton role="menuitem" onClick={onReset}>
                Reset to Default
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={onEnterValue}>
                Enter Value
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={onCopyValue}>
                Copy Value
            </DawMenuButton>
            <DawMenuButton role="menuitem" onClick={onPasteValue}>
                Paste Value
            </DawMenuButton>
        </DawContextMenuSurface>
    );
};

function useMasterGainMenu(controlRef: RefObject<HTMLDivElement | null>) {
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const close = (): void => setMenu(null);
    useContextMenuDismiss(menuRef, close);

    const open = (x: number, y: number): void => {
        controlRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
        setMenu({ x, y });
    };
    const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        open(event.clientX, event.clientY);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const bounds = controlRef.current?.querySelector('[role="slider"]')?.getBoundingClientRect();
        open(bounds?.left ?? 0, bounds?.bottom ?? 0);
    };
    return { menu, menuRef, close, onContextMenu, onKeyDown };
}

function useMasterGainActions(
    props: MasterGainControlProps,
    controlRef: RefObject<HTMLDivElement | null>,
    closeMenu: () => void
) {
    const { value, onChange, onEnterValue, onResetToDefault, onCopyValue, onPasteValue, onInvalidatePendingValue } =
        props;
    const { latestPrompt, mounted, invalidatePrompt, restoreFocus } = useMasterGainPromptFocus(controlRef);

    const handleFaderChange = (gain: number, isTransient?: boolean): void => {
        invalidatePrompt();
        onChange(gain, isTransient);
    };
    const enterValue = async (): Promise<void> => {
        invalidatePrompt();
        onInvalidatePendingValue();
        const request = latestPrompt.current;
        const authority = captureProjectTransitionAuthority();
        const initialValue = `${formatGainDb(value)} dB`;
        closeMenu();
        const input = await promptUser({
            title: 'Enter Master Gain',
            message: `Enter master gain from ${TRACK_FADER_LAW.floorDb} to +${TRACK_FADER_LAW.ceilingDb} dB; -∞ for silence.`,
            initialValue,
            confirmLabel: 'Set Gain',
        });
        if (!mounted.current || request !== latestPrompt.current || !authority.isCurrent()) {
            return;
        }
        restoreFocus(request, authority);
        if (input === null || input === initialValue) {
            return;
        }
        const gain = parseMasterGainEntry(input);
        if (gain === null) {
            notifyUser(
                `Enter a valid master gain from ${TRACK_FADER_LAW.floorDb} to +${TRACK_FADER_LAW.ceilingDb} dB, or -∞ for silence.`,
                'error'
            );
            return;
        }
        onEnterValue(gain);
    };
    const resetGain = (): void => {
        invalidatePrompt();
        onInvalidatePendingValue();
        onResetToDefault();
        closeMenu();
    };
    const copyValue = (): void => {
        invalidatePrompt();
        onCopyValue();
        closeMenu();
    };
    const pasteValue = (): void => {
        invalidatePrompt();
        onPasteValue();
        closeMenu();
    };
    return { handleFaderChange, enterValue, resetGain, copyValue, pasteValue };
}

export const MasterGainControl = ({ ...props }: MasterGainControlProps): ReactElement => {
    const masterGainControlRef = useRef<HTMLDivElement>(null);
    const { menu, menuRef, close, onContextMenu, onKeyDown } = useMasterGainMenu(masterGainControlRef);
    const { handleFaderChange, enterValue, resetGain, copyValue, pasteValue } = useMasterGainActions(
        props,
        masterGainControlRef,
        close
    );

    return (
        <>
            <div
                ref={masterGainControlRef}
                className="shrink-0"
                data-testid="master-gain"
                role="presentation"
                onContextMenu={onContextMenu}
                onKeyDown={onKeyDown}
            >
                <MasterGainFader value={props.value} onChange={handleFaderChange} />
            </div>
            {menu ? (
                <MasterGainMenu
                    position={menu}
                    menuRef={menuRef}
                    onClose={close}
                    onReset={resetGain}
                    onEnterValue={() => void enterValue()}
                    onCopyValue={copyValue}
                    onPasteValue={pasteValue}
                />
            ) : null}
        </>
    );
};

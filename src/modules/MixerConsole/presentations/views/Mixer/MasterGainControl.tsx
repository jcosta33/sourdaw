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
import { FADER_HEADROOM_DB, FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { promptUser } from '#/utils/Notification/promptUser';
import { useContextMenuDismiss } from '#/utils/UI/useContextMenuDismiss';

import { parseMasterGainEntry } from './parseMasterGainEntry';

type MasterGainControlProps = {
    value: number;
    onChange: (value: number, isTransient?: boolean) => void;
    onEnterValue: (value: number) => void;
};

type MasterGainMenuProps = {
    position: { x: number; y: number };
    menuRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onReset: () => void;
    onEnterValue: () => void;
};

const MasterGainMenu = ({ position, menuRef, onClose, onReset, onEnterValue }: MasterGainMenuProps): ReactElement => (
    <DawContextMenuSurface
        ref={menuRef}
        role="menu"
        aria-label="Master gain actions"
        x={position.x}
        y={position.y}
        onClose={onClose}
    >
        <DawMenuButton role="menuitem" onClick={onReset}>
            Reset to Default
        </DawMenuButton>
        <DawMenuButton role="menuitem" onClick={onEnterValue}>
            Enter Value
        </DawMenuButton>
    </DawContextMenuSurface>
);

export const MasterGainControl = ({ value, onChange, onEnterValue }: MasterGainControlProps): ReactElement => {
    const [masterGainMenu, setMasterGainMenu] = useState<{ x: number; y: number } | null>(null);
    const masterGainControlRef = useRef<HTMLDivElement>(null);
    const masterGainMenuRef = useRef<HTMLDivElement>(null);
    const latestPrompt = useRef(0);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            latestPrompt.current += 1;
        };
    }, []);

    const closeMasterGainMenu = (): void => setMasterGainMenu(null);
    useContextMenuDismiss(masterGainMenuRef, closeMasterGainMenu);

    const openMasterGainMenu = (x: number, y: number): void => {
        masterGainControlRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
        setMasterGainMenu({ x, y });
    };

    const handleMasterGainContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        openMasterGainMenu(event.clientX, event.clientY);
    };

    const handleMasterGainMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const bounds = masterGainControlRef.current?.querySelector('[role="slider"]')?.getBoundingClientRect();
        openMasterGainMenu(bounds?.left ?? 0, bounds?.bottom ?? 0);
    };

    const handleFaderChange = (gain: number, isTransient?: boolean): void => {
        latestPrompt.current += 1;
        onChange(gain, isTransient);
    };

    const enterValue = async (): Promise<void> => {
        const request = ++latestPrompt.current;
        const authority = captureProjectTransitionAuthority();
        const initialValue = `${formatGainDb(value)} dB`;
        closeMasterGainMenu();
        const input = await promptUser({
            title: 'Enter Master Gain',
            message: `Enter master gain in dB (maximum +${FADER_HEADROOM_DB} dB; -∞ for silence).`,
            initialValue,
            confirmLabel: 'Set Gain',
        });
        if (!mounted.current || request !== latestPrompt.current || !authority.isCurrent() || input === null) {
            return;
        }
        // The readout rounds to one decimal; submitting it untouched must not
        // replace the more precise gain already in project truth.
        if (input === initialValue) {
            return;
        }
        const gain = parseMasterGainEntry(input);
        if (gain === null) {
            notifyUser(`Enter a valid master gain in dB at or below +${FADER_HEADROOM_DB} dB.`, 'error');
            return;
        }
        onEnterValue(gain);
    };

    const resetGain = (): void => {
        latestPrompt.current += 1;
        onChange(defaultTransportState.masterGain / 100, false);
        closeMasterGainMenu();
    };

    return (
        <>
            <div
                ref={masterGainControlRef}
                className="shrink-0"
                data-testid="master-gain"
                role="presentation"
                onContextMenu={handleMasterGainContextMenu}
                onKeyDown={handleMasterGainMenuKeyDown}
            >
                <Fader
                    value={value}
                    onChange={handleFaderChange}
                    min={0}
                    max={FADER_MAX_GAIN}
                    step={0.01}
                    fineStep={0.001}
                    defaultValue={defaultTransportState.masterGain / 100}
                    height={100}
                    aria-label="Master gain"
                />
            </div>
            {masterGainMenu ? (
                <MasterGainMenu
                    position={masterGainMenu}
                    menuRef={masterGainMenuRef}
                    onClose={closeMasterGainMenu}
                    onReset={resetGain}
                    onEnterValue={() => void enterValue()}
                />
            ) : null}
        </>
    );
};

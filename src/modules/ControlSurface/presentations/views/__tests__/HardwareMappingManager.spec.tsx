import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OBJECT_URL_LIFETIME_MS } from '#/utils/downloadFile';

import { PUSH_2_PROFILE } from '../../../models/ControllerProfile';
import { hardwareControllerStore } from '../../../stores/hardwareControllerStore';
import { HardwareMappingManager } from '../HardwareMappingManager';

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));

function fileFromBlob(blob: Blob): File {
    const file = new File([blob], 'mappings.json', { type: 'application/json' });
    // jsdom has FileReader but does not implement the browser's Blob.text().
    Object.defineProperty(file, 'text', {
        value: () =>
            new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    if (typeof reader.result !== 'string') {
                        reject(new Error('Expected text from FileReader'));
                        return;
                    }
                    resolve(reader.result);
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            }),
    });
    return file;
}

function mappingFile(json: string): File {
    return fileFromBlob(new Blob([json], { type: 'application/json' }));
}

function fileInput(): HTMLInputElement {
    const input = screen.getByLabelText('Mapping JSON file');
    if (!(input instanceof HTMLInputElement)) {
        throw new Error('Expected a mapping file input');
    }
    return input;
}

function exportedBlob(): Blob {
    const candidate = vi.mocked(URL.createObjectURL).mock.lastCall?.[0];
    if (!(candidate instanceof Blob)) {
        throw new Error('Expected an actual exported Blob');
    }
    return candidate;
}

describe('HardwareMappingManager', () => {
    const factoryProfile = JSON.stringify(PUSH_2_PROFILE);

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'URL',
            class extends URL {
                static createObjectURL = vi.fn(() => 'blob:mappings');
                static revokeObjectURL = vi.fn();
            }
        );
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        hardwareControllerStore.set({
            connectedDevices: [{ id: 'input', name: 'Input', profileId: 'push-2' }],
            profiles: [
                structuredClone(PUSH_2_PROFILE),
                { id: 'other', name: 'Other profile', manufacturer: 'Other', productId: ['other'], mappings: [] },
            ],
        });
    });

    afterEach(async () => {
        cleanup();
        try {
            await waitFor(() => expect(document.querySelector('a[download]')).toBeNull(), {
                timeout: OBJECT_URL_LIFETIME_MS * 2,
            });
        } finally {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
        expect(JSON.stringify(PUSH_2_PROFILE)).toBe(factoryProfile);
    });

    it('inspects real profiles and round-trips actual downloaded bytes through the visible file input', async () => {
        render(<HardwareMappingManager />);
        const original = hardwareControllerStore.value!;
        const table = screen.getByRole('table', { name: 'Push 2 mappings' });
        expect(within(table).getByText('button 85')).toBeInTheDocument();
        expect(within(table).getByText('transport: togglePlayback')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Export mappings' }));
        const originalFile = fileFromBlob(exportedBlob());
        const originalJson = await originalFile.text();
        expect(JSON.parse(originalJson)).toEqual(original.profiles[0]?.mappings);
        expect(exportedBlob().type).toBe('application/json');

        const changedJson = originalJson.replace('"controlIndex": 85', '"controlIndex": 86');
        fireEvent.change(fileInput(), { target: { files: [mappingFile(changedJson)] } });
        await waitFor(() => expect(screen.getByText('button 86')).toBeInTheDocument());
        expect(screen.getByRole('status')).toHaveTextContent('Mappings imported.');
        expect(hardwareControllerStore.value?.profiles[1]).toBe(original.profiles[1]);
        expect(hardwareControllerStore.value?.connectedDevices).toBe(original.connectedDevices);

        fireEvent.click(screen.getByRole('button', { name: 'Export mappings' }));
        expect(JSON.parse(await fileFromBlob(exportedBlob()).text())).toEqual(JSON.parse(changedJson));
        fireEvent.change(fileInput(), { target: { files: [originalFile] } });
        await waitFor(() => expect(screen.getByText('button 85')).toBeInTheDocument());
        expect(hardwareControllerStore.value).toEqual(original);
    });

    it.each(['{bad json', '{}', '[{"id":"broken"}]'])(
        'rejects invalid files without changing any profile: %s',
        async (json) => {
            render(<HardwareMappingManager />);
            const before = hardwareControllerStore.value;
            fireEvent.change(fileInput(), { target: { files: [mappingFile(json)] } });
            await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not imported'));
            expect(hardwareControllerStore.value).toBe(before);
            expect(screen.getByText('button 85')).toBeInTheDocument();
            expect(mocks.notify).toHaveBeenCalledTimes(1);
        }
    );

    it('accepts an empty list and permits the same file to be selected again', async () => {
        render(<HardwareMappingManager />);
        const file = mappingFile('[]');
        fireEvent.change(fileInput(), { target: { files: [file] } });
        await waitFor(() => expect(screen.getByText('This profile has no mappings.')).toBeInTheDocument());
        expect(fileInput().value).toBe('');
        fireEvent.change(fileInput(), { target: { files: [file] } });
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Mappings imported.'));
        fireEvent.click(screen.getByRole('button', { name: 'Export mappings' }));
        expect(await fileFromBlob(exportedBlob()).text()).toBe('[]');
    });

    it('does nothing when the file picker is cancelled', () => {
        render(<HardwareMappingManager />);
        const before = hardwareControllerStore.value;
        fireEvent.change(fileInput(), { target: { files: [] } });
        expect(hardwareControllerStore.value).toBe(before);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps an older read cancelled after selecting another profile and returning', async () => {
        render(<HardwareMappingManager />);
        let resolveRead!: (value: string) => void;
        const read = new Promise<string>((resolve) => {
            resolveRead = resolve;
        });
        const file = new File([], 'pending.json');
        Object.defineProperty(file, 'text', { value: () => read });
        const before = hardwareControllerStore.value;
        fireEvent.change(fileInput(), { target: { files: [file] } });
        expect(screen.getByRole('status')).toHaveTextContent('Reading mapping file');
        fireEvent.change(screen.getByRole('combobox', { name: 'Hardware profile' }), { target: { value: 'other' } });
        expect(screen.getByText('This profile has no mappings.')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Hardware profile' }), { target: { value: 'push-2' } });
        await act(async () => {
            resolveRead('[]');
            await read;
        });
        expect(hardwareControllerStore.value).toBe(before);
        expect(screen.getByText('button 85')).toBeInTheDocument();
        expect(screen.queryByText('Mappings imported.')).not.toBeInTheDocument();
    });

    it('does not publish a late read after closing the view', async () => {
        let resolveRead!: (value: string) => void;
        const read = new Promise<string>((resolve) => {
            resolveRead = resolve;
        });
        const file = new File([], 'pending.json');
        Object.defineProperty(file, 'text', { value: () => read });
        const before = hardwareControllerStore.value;
        const view = render(<HardwareMappingManager />);
        fireEvent.change(fileInput(), { target: { files: [file] } });
        view.unmount();
        await act(async () => {
            resolveRead('[]');
            await read;
        });
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('lets only the newest selected file commit when the older read finishes first', async () => {
        render(<HardwareMappingManager />);
        let resolveOld!: (value: string) => void;
        let resolveNew!: (value: string) => void;
        const oldRead = new Promise<string>((resolve) => {
            resolveOld = resolve;
        });
        const newRead = new Promise<string>((resolve) => {
            resolveNew = resolve;
        });
        const oldFile = new File([], 'old.json');
        const newFile = new File([], 'new.json');
        Object.defineProperty(oldFile, 'text', { value: () => oldRead });
        Object.defineProperty(newFile, 'text', { value: () => newRead });
        const before = hardwareControllerStore.value!;
        fireEvent.change(fileInput(), { target: { files: [oldFile] } });
        fireEvent.change(fileInput(), { target: { files: [newFile] } });
        await act(async () => {
            resolveOld('[]');
            await oldRead;
        });
        expect(hardwareControllerStore.value).toBe(before);
        expect(screen.queryByText('Mappings imported.')).not.toBeInTheDocument();
        const json = JSON.stringify(before.profiles[0]?.mappings.map((mapping) => ({ ...mapping, controlIndex: 86 })));
        await act(async () => {
            resolveNew(json);
            await newRead;
        });
        expect(screen.getByText('button 86')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Mappings imported.');
    });

    it('shows the size refusal before attempting to read an oversized file', async () => {
        render(<HardwareMappingManager />);
        const before = hardwareControllerStore.value;
        const file = new File([], 'large.json');
        const read = vi.fn();
        Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 + 1 });
        Object.defineProperty(file, 'text', { value: read });
        fireEvent.change(fileInput(), { target: { files: [file] } });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not imported'));
        expect(read).not.toHaveBeenCalled();
        expect(hardwareControllerStore.value).toBe(before);
        expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('16 MiB'), 'error');
    });

    it('shows a read failure and preserves the original rows', async () => {
        render(<HardwareMappingManager />);
        const before = hardwareControllerStore.value;
        const file = new File([], 'unreadable.json');
        Object.defineProperty(file, 'text', { value: () => Promise.reject(new Error('File unavailable')) });
        fireEvent.change(fileInput(), { target: { files: [file] } });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not imported'));
        expect(hardwareControllerStore.value).toBe(before);
        expect(screen.getByText('button 85')).toBeInTheDocument();
    });

    it('shows an empty registry and disables file operations', () => {
        hardwareControllerStore.set({ connectedDevices: [], profiles: [] });
        render(<HardwareMappingManager />);
        expect(screen.getByText('No hardware profiles are available.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Export mappings' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Import mappings' })).toBeDisabled();
    });
});

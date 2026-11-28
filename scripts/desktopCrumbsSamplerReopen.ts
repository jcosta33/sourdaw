import assert from 'node:assert/strict';

import { readCrumbsSnapshot } from './desktopCrumbsSamplerSnapshot.ts';

import type { CrumbsSamplerObservations } from './desktopCrumbsSamplerEvidence.ts';
import type { Page } from 'playwright';

export async function observeReopenedWorkspace(page: Page, observations: CrumbsSamplerObservations): Promise<void> {
    assert(observations.trackId && observations.deviceId && observations.savedSnapshot);
    const trackId = observations.trackId;
    const deadline = Date.now() + 20000;
    let state: string;
    do {
        const current = await page.evaluate(() => {
            const visible = (selector: string) => {
                const element = document.querySelector(selector);
                return (
                    element instanceof HTMLElement &&
                    element.getBoundingClientRect().width > 0 &&
                    getComputedStyle(element).visibility !== 'hidden'
                );
            };
            return {
                launch: visible('[role="dialog"][aria-label="Sourdaw — start a project"]'),
                failure: visible('[role="alertdialog"][aria-labelledby="project-load-failure-title"]'),
                startupShell: visible('#entry-startup'),
                startupFailure: Array.from(document.querySelectorAll('button')).some(
                    (button) =>
                        button.textContent.trim() === 'Reload Sourdaw' &&
                        !button.closest('#entry-startup') &&
                        button.getBoundingClientRect().width > 0
                ),
                grid: visible('[role="grid"][aria-label="Track list"]'),
                trackIds: Array.from(
                    document.querySelectorAll('[role="grid"][aria-label="Track list"] [data-track-id]')
                )
                    .filter(
                        (element) =>
                            element instanceof HTMLElement &&
                            element.getBoundingClientRect().width > 0 &&
                            getComputedStyle(element).visibility !== 'hidden'
                    )
                    .map((element) => element.getAttribute('data-track-id'))
                    .filter((id): id is string => id !== null),
                detail: (document.querySelector('#project-load-failure-message')?.textContent ?? '').slice(0, 500),
            };
        });
        const { trackIds, detail } = current;
        state = 'loading';
        if (current.failure) {
            state = 'project-load-failure';
        } else if (current.startupFailure) {
            state = 'launch-failure';
        } else if (current.startupShell) {
            state = 'startup-shell';
        } else if (current.launch) {
            state = 'launch-screen';
        } else if (current.grid) {
            state = trackIds.includes(trackId) ? 'original-track' : 'workspace-missing-track';
        }
        observations.reopenStartup = { state, trackIds, detail, binary: 'not-read' };
        if (state === 'original-track' || state === 'project-load-failure' || state === 'launch-failure') {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    const startup = observations.reopenStartup;
    try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const reopened = await Promise.race([
            readCrumbsSnapshot(page, trackId, observations.deviceId, observations.savedHeads),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('binary read timed out')), 5000);
            }),
        ]).finally(() => clearTimeout(timer));
        startup.binary =
            reopened.savedHeadsPresent &&
            JSON.stringify(reopened.snapshot) === JSON.stringify(observations.savedSnapshot)
                ? 'matched'
                : 'mismatch';
        if (state === 'original-track' && startup.binary === 'matched') {
            observations.reopenedSnapshot = reopened.snapshot;
            observations.reopenedHeads = reopened.heads;
            observations.savedHeadsPresent = reopened.savedHeadsPresent;
            return;
        }
    } catch (error) {
        startup.binary = error instanceof Error ? error.message.slice(0, 500) : 'binary read failed';
    }
    throw new Error(`reopened workspace ${state}; binary ${startup.binary}`);
}

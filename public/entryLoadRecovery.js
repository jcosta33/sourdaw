(() => {
    const retryKey = 'sourdaw:entry-load-retry-v1';
    let handled = false;

    function isEntryScript(target) {
        if (!(target instanceof HTMLScriptElement)) {
            return false;
        }
        const sourceEntry = document.getElementById('sourdaw-entry');
        if (sourceEntry !== null) {
            return target === sourceEntry;
        }
        // Vite replaces the source entry with a single crossorigin module script.
        const builtEntries = document.querySelectorAll('script[type="module"][src][crossorigin]');
        return builtEntries.length === 1 && target === builtEntries[0];
    }

    function claimAutomaticRetry() {
        if (
            !['http:', 'https:'].includes(window.location.protocol) ||
            'sourdaw' in window ||
            navigator.userAgent.includes('Electron/')
        ) {
            return false;
        }
        try {
            // Any existing value, including corrupt data, exhausts the tab's budget.
            if (window.sessionStorage.getItem(retryKey) !== null) {
                return false;
            }
            window.sessionStorage.setItem(retryKey, 'used');
            return window.sessionStorage.getItem(retryKey) === 'used';
        } catch {
            return false;
        }
    }

    function showFailure() {
        const title = document.getElementById('entry-startup-title');
        const description = document.getElementById('entry-startup-description');
        const button = document.getElementById('entry-startup-reload');
        if (title === null || description === null || button === null) {
            return;
        }
        title.textContent = 'Sourdaw could not start';
        title.parentElement.setAttribute('role', 'alert');
        description.textContent = 'The application did not load. Reload Sourdaw to try starting it again.';
        button.addEventListener('click', () => window.location.reload());
        button.hidden = false;
    }

    window.addEventListener('sourdaw:initial-render-failed', showFailure, { once: true });

    // This independent deferred script runs before the later module entry.
    window.addEventListener(
        'error',
        (event) => {
            if (
                handled ||
                document.documentElement.hasAttribute('data-sourdaw-entry-started') ||
                !isEntryScript(event.target)
            ) {
                return;
            }
            handled = true;
            if (claimAutomaticRetry()) {
                window.location.reload();
                return;
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', showFailure, { once: true });
                return;
            }
            showFailure();
        },
        true
    );
})();

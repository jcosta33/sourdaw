const path = require('node:path');

const { defineConfig, devices } = require('@playwright/test');

const port = 52_743;

module.exports = defineConfig({
    testDir: '.',
    timeout: 60_000,
    reporter: 'line',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `node_modules/.bin/vite --host 127.0.0.1 --port ${port} --strictPort`,
        cwd: path.resolve(__dirname, '../..'),
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
    },
});

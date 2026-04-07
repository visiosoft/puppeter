require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const express = require('express');
const { loadDashboardConfig, saveDashboardConfig, normalizeConfig } = require('./src/utils/dashboard-config');
const { startDashboardRun, stopDashboardRun, getDashboardStatus } = require('./src/modules/dashboard-runner');

const app = express();
const CONFIG_FILE = path.join(__dirname, 'data', 'dashboard-config.json');
const config = saveDashboardConfig(loadDashboardConfig());
const port = config.settings.dashboardPort || 3010;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.type('application/json').send(fs.readFileSync(CONFIG_FILE, 'utf-8'));
});

app.post('/api/config', (req, res) => {
    saveDashboardConfig(normalizeConfig(req.body || {}));
    res.type('application/json').send(fs.readFileSync(CONFIG_FILE, 'utf-8'));
});

app.get('/api/status', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(getDashboardStatus());
});

app.post('/api/run', async (req, res) => {
    try {
        startDashboardRun(req.body || {}).catch(error => {
            console.error('[dashboard]', error.message);
        });
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
    }
});

app.post('/api/stop', (req, res) => {
    const stopped = stopDashboardRun();
    res.json({ ok: true, stopped });
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`[dashboard] Dashboard running at http://localhost:${port}`);
});

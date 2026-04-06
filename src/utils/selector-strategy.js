const fs = require('fs');
const path = require('path');

const STRATEGY_FILE = path.join(__dirname, '../../data/selector-strategy.json');

function getSelectorStrategy() {
    try {
        if (!fs.existsSync(STRATEGY_FILE)) {
            return {};
        }

        return JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

function saveSelectorStrategy(update) {
    try {
        const current = getSelectorStrategy();
        const next = {
            ...current,
            ...update,
            updatedAt: new Date().toISOString(),
        };

        fs.writeFileSync(STRATEGY_FILE, JSON.stringify(next, null, 2));
        return next;
    } catch {
        return null;
    }
}

module.exports = {
    getSelectorStrategy,
    saveSelectorStrategy,
};
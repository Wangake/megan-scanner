const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Logging with colors
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    
    const colors = {
        info: chalk.blue,
        success: chalk.green,
        warn: chalk.yellow,
        error: chalk.red
    };
    
    const color = colors[type] || chalk.white;
    console.log(color(`[${timestamp}] ${message}`));
}

// Clean up old sessions
async function cleanupSessions() {
    const tempDir = path.join(__dirname, 'temp');
    
    if (!await fs.pathExists(tempDir)) return;
    
    const sessions = await fs.readdir(tempDir);
    const now = Date.now();
    const maxAge = 3600000; // 1 hour
    
    for (const session of sessions) {
        const sessionPath = path.join(tempDir, session);
        const stats = await fs.stat(sessionPath);
        
        if (now - stats.mtimeMs > maxAge) {
            await fs.remove(sessionPath);
            log(`Cleaned up old session: ${session}`, 'info');
        }
    }
}

// Get session stats
async function getStats() {
    const tempDir = path.join(__dirname, 'temp');
    
    if (!await fs.pathExists(tempDir)) {
        return { total: 0, active: 0 };
    }
    
    const sessions = await fs.readdir(tempDir);
    const now = Date.now();
    
    let active = 0;
    for (const session of sessions) {
        const sessionPath = path.join(tempDir, session);
        const stats = await fs.stat(sessionPath);
        if (now - stats.mtimeMs < 300000) { // 5 minutes
            active++;
        }
    }
    
    return {
        total: sessions.length,
        active
    };
}

module.exports = {
    log,
    cleanupSessions,
    getStats
};
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const { makeid, formatPhone, formatCode } = require('./id');
const { log } = require('./utils');

const router = express.Router();
const activeSessions = new Map();

// Session timeout: 10 minutes
const SESSION_TIMEOUT = 600000;

// Cleanup old sessions from memory
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of activeSessions.entries()) {
        if (now - session.createdAt > SESSION_TIMEOUT) {
            activeSessions.delete(id);
            fs.remove(`./temp/${id}`).catch(() => {});
            log(`Cleaned up session ${id}`, 'info');
        }
    }
}, 300000);

// Generate pairing code endpoint
router.get('/', async (req, res) => {
    let { number } = req.query;
    const sessionId = makeid(8);
    
    try {
        // Validate number
        if (!number) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phone number is required' 
            });
        }

        // Clean and format number
        number = number.replace(/[^0-9]/g, '');
        
        // Ensure country code (default to 254 for Kenya)
        if (number.length === 9) {
            number = '254' + number;
        } else if (number.length === 10 && number.startsWith('0')) {
            number = '254' + number.substring(1);
        }

        // Validate length
        if (number.length < 10 || number.length > 15) {
            return res.status(400).json({
                success: false,
                error: 'Invalid number. Must include country code (e.g., 254XXXXXXXXX)'
            });
        }

        log(`[${sessionId}] 📱 Pairing request for: ${number}`, 'info');

        // Create session directory
        const sessionDir = path.join(__dirname, 'temp', sessionId);
        await fs.ensureDir(sessionDir);

        // Store session info
        activeSessions.set(sessionId, {
            number,
            createdAt: Date.now(),
            status: 'initiated',
            dir: sessionDir
        });

        // Start pairing process in background
        processPairing(number, sessionId).catch(err => {
            log(`[${sessionId}] ❌ Background error: ${err.message}`, 'error');
            activeSessions.set(sessionId, {
                ...activeSessions.get(sessionId),
                status: 'error',
                error: err.message
            });
        });

        // Return session ID immediately
        res.json({
            success: true,
            sessionId,
            message: 'Pairing initiated. Check status endpoint.',
            number
        });

    } catch (err) {
        log(`❌ Error: ${err.message}`, 'error');
        res.status(500).json({ 
            success: false, 
            error: err.message || 'Internal server error' 
        });
    }
});

// Status check endpoint
router.get('/status/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);
    
    if (!session) {
        // Check if files still exist
        const sessionDir = path.join(__dirname, 'temp', sessionId);
        if (await fs.pathExists(sessionDir)) {
            // Check for code file
            const codeFile = path.join(sessionDir, 'code.txt');
            if (await fs.pathExists(codeFile)) {
                const code = await fs.readFile(codeFile, 'utf8');
                return res.json({
                    success: true,
                    status: 'code_ready',
                    code: formatCode(code),
                    phone: session?.number
                });
            }
        }
        return res.json({ 
            success: false, 
            status: 'expired',
            error: 'Session expired or not found' 
        });
    }

    // Check for code file
    const codeFile = path.join(session.dir, 'code.txt');
    if (await fs.pathExists(codeFile)) {
        const code = await fs.readFile(codeFile, 'utf8');
        return res.json({
            success: true,
            status: 'code_ready',
            code: formatCode(code),
            phone: session.number
        });
    }

    // Check for error file
    const errorFile = path.join(session.dir, 'error.txt');
    if (await fs.pathExists(errorFile)) {
        const error = await fs.readFile(errorFile, 'utf8');
        return res.json({
            success: false,
            status: 'error',
            error
        });
    }

    // Still processing
    res.json({
        success: true,
        status: session.status,
        phone: session.number,
        timeLeft: Math.max(0, Math.floor((SESSION_TIMEOUT - (Date.now() - session.createdAt)) / 1000))
    });
});

// Cancel session
router.delete('/cancel/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    
    try {
        await fs.remove(`./temp/${sessionId}`);
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Session cancelled' });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

async function processPairing(number, sessionId) {
    const sessionDir = path.join(__dirname, 'temp', sessionId);
    let sock = null;

    try {
        log(`[${sessionId}] 🔄 Starting pairing process...`, 'info');

        // Update status
        activeSessions.set(sessionId, {
            ...activeSessions.get(sessionId),
            status: 'connecting'
        });

        // Get auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        // Create socket with optimal settings for Railway
        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "120.0.0"], // Works on Railway
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            generateHighQualityLinkPreview: false
        });

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                log(`[${sessionId}] ✅ Device connected successfully!`, 'success');
                
                activeSessions.set(sessionId, {
                    ...activeSessions.get(sessionId),
                    status: 'connected'
                });

                // Send session file to user
                try {
                    await delay(3000);
                    
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (await fs.pathExists(credsPath)) {
                        const creds = await fs.readFile(credsPath, 'base64');
                        
                        await sock.sendMessage(sock.user.id, {
                            document: await fs.readFile(credsPath),
                            fileName: 'creds.json',
                            mimetype: 'application/json',
                            caption: `✅ *MEGAN-MD SESSION*\n\nPhone: ${number}\nCode: ${await fs.readFile(path.join(sessionDir, 'code.txt'), 'utf8')}\n\nKeep this file safe!`
                        });
                        
                        log(`[${sessionId}] 📎 Session file sent`, 'success');
                    }
                } catch (sendErr) {
                    log(`[${sessionId}] ⚠️ Could not send file: ${sendErr.message}`, 'warn');
                }

                // Keep connection alive for a bit
                await delay(10000);
                await sock.ws.close();
                
                // Mark for cleanup but keep files
                activeSessions.set(sessionId, {
                    ...activeSessions.get(sessionId),
                    status: 'completed'
                });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                log(`[${sessionId}] 🔌 Connection closed: ${statusCode || 'unknown'}`, 'info');
            }
        });

        // Save credentials
        sock.ev.on('creds.update', saveCreds);

        // Request pairing code
        await delay(2000);

        if (!sock.authState.creds.registered) {
            log(`[${sessionId}] 🔑 Requesting pairing code...`, 'info');
            
            try {
                const code = await sock.requestPairingCode(number);
                await fs.writeFile(path.join(sessionDir, 'code.txt'), code);
                
                log(`[${sessionId}] ✅ Code generated: ${code}`, 'success');
                
                activeSessions.set(sessionId, {
                    ...activeSessions.get(sessionId),
                    status: 'code_ready',
                    code
                });
            } catch (codeErr) {
                log(`[${sessionId}] ❌ Code request failed: ${codeErr.message}`, 'error');
                await fs.writeFile(path.join(sessionDir, 'error.txt'), codeErr.message);
                throw codeErr;
            }
        }

        // Wait for connection or timeout
        await delay(45000);

    } catch (err) {
        log(`[${sessionId}] ❌ Fatal error: ${err.message}`, 'error');
        await fs.writeFile(path.join(sessionDir, 'error.txt'), err.message).catch(() => {});
        
        activeSessions.set(sessionId, {
            ...activeSessions.get(sessionId),
            status: 'error',
            error: err.message
        });
    } finally {
        if (sock?.ws) {
            try { sock.ws.close(); } catch (e) {}
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
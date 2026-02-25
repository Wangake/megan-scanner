const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const pairingRouter = require('./pair');
const { cleanupSessions } = require('./utils');

const app = express();
const PORT = process.env.PORT || 8000;

// Ensure directories exist
fs.ensureDirSync('./temp');
fs.ensureDirSync('./public');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/code', pairingRouter);

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: Date.now(),
        sessions: fs.readdirSync('./temp').length 
    });
});

// Cleanup old sessions every hour
setInterval(cleanupSessions, 3600000);

app.listen(PORT, () => {
    console.log(chalk.green(`
╔════════════════════════════════════╗
║     MEGAN-MD PAIRING SYSTEM        ║
║         Multi-User Ready            ║
╠════════════════════════════════════╣
║  🚀 Port: ${PORT}                          ║
║  📁 Temp: ./temp                    ║
║  👥 Max Users: Unlimited            ║
║  🔧 Status: Online                   ║
╚════════════════════════════════════╝
    `));
});
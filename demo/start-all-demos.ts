#!/usr/bin/env node
/**
 * Start all demo servers concurrently
 *
 * This script launches all demo servers on their respective ports
 * and provides a unified menu interface
 */

import { spawn, exec } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import express from 'express';
import open from 'open';
import { promisify } from 'util';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

// Utility function to check if a port is in use
async function isPortInUse(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.listen(port, () => {
            server.once('close', () => resolve(false));
            server.close();
        });
        server.on('error', () => resolve(true));
    });
}

// Kill any existing processes on our demo ports
async function killExistingProcesses(ports: number[]): Promise<void> {
    console.log('🔍 Checking for existing processes on demo ports...');

    for (const port of ports) {
        try {
            // Find processes using the port
            const { stdout } = await execAsync(`lsof -ti:${port}`);
            const pids = stdout
                .trim()
                .split('\n')
                .filter(pid => pid);

            if (pids.length > 0) {
                console.log(`   Found ${pids.length} process(es) on port ${port}, killing...`);
                for (const pid of pids) {
                    try {
                        await execAsync(`kill -9 ${pid}`);
                        console.log(`   ✅ Killed process ${pid} on port ${port}`);
                    } catch (error) {
                        console.log(
                            `   ⚠️  Could not kill process ${pid}: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                }
            }
        } catch {
            // No processes found on this port, which is good
        }
    }

    // Wait a moment for processes to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
}

// Demo server configurations
const demos = [
    {
        name: 'Voice Generation',
        script: 'voice-server.ts',
        port: 3004,
        path: '/voice-client.html',
    },
    {
        name: 'Live Transcription',
        script: 'listen-server.ts',
        port: 3003,
        path: '/listen-client.html',
    },
    {
        name: 'Chat Request',
        script: 'request-server.ts',
        port: 3005,
        path: '/request-client.html',
    },
    {
        name: 'Text Embeddings',
        script: 'embed-server.ts',
        port: 3006,
        path: '/embed-client.html',
    },
];

// Start individual demo servers
async function startDemoServers() {
    console.log('🚀 Starting Ensemble demo servers...\n');

    // Get all ports that will be used
    const allPorts = [...demos.map(d => d.port), 3000]; // Include menu port

    // Kill any existing processes on these ports
    await killExistingProcesses(allPorts);

    // Verify ports are available
    for (const port of allPorts) {
        const inUse = await isPortInUse(port);
        if (inUse) {
            console.error(
                `❌ Port ${port} is still in use after cleanup. Please manually stop any processes using this port.`
            );
            process.exit(1);
        }
    }

    console.log('✅ All ports are available\n');

    const processes: any[] = [];

    demos.forEach(demo => {
        console.log(`Starting ${demo.name} server on port ${demo.port}...`);

        const proc = spawn('npx', ['tsx', join(__dirname, demo.script)], {
            stdio: 'pipe',
            shell: true,
        });

        proc.stdout.on('data', data => {
            console.log(`[${demo.name}] ${data.toString().trim()}`);
        });

        proc.stderr.on('data', data => {
            console.error(`[${demo.name}] ${data.toString().trim()}`);
        });

        proc.on('error', error => {
            console.error(`Failed to start ${demo.name}: ${error.message}`);
        });

        processes.push(proc);
    });

    // Create menu server
    const app = express();
    const MENU_PORT = 3000;

    app.use(express.static(__dirname));

    // Create a simple menu page
    app.get('/', (req, res) => {
        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ensemble Demo</title>
    <style>
        :root {
            --primary: #1a73e8;
            --primary-dark: #1557b0;
            --success: #34a853;
            --background: #f5f5f5;
            --surface: #ffffff;
            --text: #202124;
            --text-secondary: #5f6368;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--background);
            color: var(--text);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: var(--surface);
            border-radius: 16px;
            padding: 48px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.1);
            max-width: 800px;
            width: 100%;
        }

        h1 {
            color: var(--primary);
            margin-bottom: 16px;
            font-size: 36px;
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .subtitle {
            color: var(--text-secondary);
            font-size: 18px;
            margin-bottom: 40px;
        }

        .demo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
            margin-bottom: 40px;
        }

        .demo-card {
            background: #f8f9fa;
            border-radius: 12px;
            padding: 24px;
            text-decoration: none;
            color: var(--text);
            transition: all 0.2s;
            display: block;
            border: 2px solid transparent;
        }

        .demo-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-color: var(--primary);
        }

        .demo-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
        }

        .demo-icon {
            font-size: 32px;
        }

        .demo-title {
            font-size: 20px;
            font-weight: 600;
        }

        .demo-description {
            color: var(--text-secondary);
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 12px;
        }

        .demo-port {
            font-size: 12px;
            color: var(--primary);
            font-weight: 500;
        }

        .status {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px;
            background: #e8f5e9;
            border-radius: 8px;
            color: var(--success);
            font-weight: 500;
        }

        .status-indicator {
            width: 12px;
            height: 12px;
            background: var(--success);
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.8; transform: scale(1.2); }
        }

        .instructions {
            margin-top: 40px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 14px;
            color: var(--text-secondary);
        }

        .instructions code {
            background: #e8eaed;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
            </svg>
            Ensemble Demo
        </h1>
        <p class="subtitle">Interactive demonstrations of the Ensemble AI library</p>

        <div class="status">
            <span class="status-indicator"></span>
            All demo servers are running
        </div>

        <div class="demo-grid">
            ${demos
                .map(
                    demo => `
                <a href="http://localhost:${demo.port}${demo.path}" class="demo-card" target="_blank">
                    <div class="demo-header">
                        <div class="demo-icon">${
                            demo.name.includes('Voice')
                                ? '🎤'
                                : demo.name.includes('Transcription')
                                  ? '🎧'
                                  : demo.name.includes('Chat')
                                    ? '💬'
                                    : '📊'
                        }</div>
                        <div class="demo-title">${demo.name}</div>
                    </div>
                    <div class="demo-description">${
                        demo.name.includes('Voice')
                            ? 'Convert text to natural-sounding speech with multiple voices and providers'
                            : demo.name.includes('Transcription')
                              ? 'Real-time speech-to-text with streaming audio processing'
                              : demo.name.includes('Chat')
                                ? 'Streaming AI responses with tool calling and multi-model support'
                                : 'Generate vector embeddings and perform similarity search'
                    }</div>
                    <div class="demo-port">Port ${demo.port} →</div>
                </a>
            `
                )
                .join('')}
        </div>

        <div class="instructions">
            <strong>Instructions:</strong>
            <ul style="margin-left: 20px; margin-top: 8px;">
                <li>Click on any demo card to open it in a new tab</li>
                <li>Each demo runs on its own port for better performance</li>
                <li>Make sure you have API keys set in your <code>.env</code> file</li>
                <li>To stop all servers, press <code>Ctrl+C</code> in the terminal</li>
            </ul>
        </div>
    </div>
</body>
</html>
        `);
    });

    // Start menu server
    app.listen(MENU_PORT, () => {
        console.log(`\n✅ All demo servers started!`);
        console.log(`\n📋 Demo Menu: http://localhost:${MENU_PORT}`);
        console.log('\nIndividual demos:');
        demos.forEach(demo => {
            console.log(`   • ${demo.name}: http://localhost:${demo.port}${demo.path}`);
        });
        console.log('\nPress Ctrl+C to stop all servers\n');

        // Open the menu in the default browser
        setTimeout(() => {
            open(`http://localhost:${MENU_PORT}`);
        }, 2000);
    });

    // Handle cleanup
    process.on('SIGINT', () => {
        console.log('\n\nShutting down all demo servers...');
        processes.forEach(proc => {
            proc.kill();
        });
        process.exit(0);
    });

    process.on('exit', () => {
        processes.forEach(proc => {
            proc.kill();
        });
    });
}

// Start the demo servers
startDemoServers().catch(err => {
    console.error('Failed to start demo servers:', err);
    process.exit(1);
});

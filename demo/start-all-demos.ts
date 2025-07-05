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
        path: '/voice',
    },
    {
        name: 'Live Transcription',
        script: 'listen-server.ts',
        port: 3003,
        path: '/listen',
    },
    {
        name: 'Chat Request',
        script: 'request-server.ts',
        port: 3005,
        path: '/request',
    },
    {
        name: 'Text Embeddings',
        script: 'embed-server.ts',
        port: 3006,
        path: '/embed',
    },
];

// Start individual demo servers
async function startDemoServers() {
    console.log('🚀 Starting Ensemble demo servers...\n');

    // Get all ports that will be used
    const allPorts = [...demos.map(d => d.port), 3000]; // Include React dev server port

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

    // Start the React dev server first
    console.log('Starting React dev server on port 3000...');
    const reactProc = spawn('npm', ['run', 'dev'], {
        cwd: __dirname,
        stdio: 'pipe',
        shell: true,
    });

    reactProc.stdout.on('data', data => {
        const output = data.toString().trim();
        if (output) {
            console.log(`[React] ${output}`);
        }
    });

    reactProc.stderr.on('data', data => {
        const output = data.toString().trim();
        // Filter out non-error messages from stderr
        if (output && !output.includes('deprecation') && !output.includes('warning')) {
            console.error(`[React] ${output}`);
        }
    });

    reactProc.on('error', error => {
        console.error(`Failed to start React dev server: ${error.message}`);
    });

    processes.push(reactProc);

    // Wait a bit for React server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start backend demo servers
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

    // Wait for all servers to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`\n✅ All demo servers started!`);
    console.log(`\n🚀 React App: http://localhost:3000`);
    console.log('\nBackend API servers:');
    demos.forEach(demo => {
        console.log(`   • ${demo.name}: http://localhost:${demo.port} (API)`);
    });
    console.log('\nDemo pages:');
    demos.forEach(demo => {
        console.log(`   • ${demo.name}: http://localhost:3000${demo.path}`);
    });
    console.log('\nPress Ctrl+C to stop all servers\n');

    // Open the React app in the default browser
    setTimeout(() => {
        open(`http://localhost:3000`);
    }, 1000);

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

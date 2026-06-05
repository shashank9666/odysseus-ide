const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let pyProc = null;
const PORT = process.env.APP_PORT || 7000;
const HOST = '127.0.0.1';
const HEALTH_URL = `http://${HOST}:${PORT}/api/health`;
const APP_URL = `http://${HOST}:${PORT}`;

// Resolve the Python path in the virtual environment
function getPythonPath() {
  if (os.platform() === 'win32') {
    return path.join(__dirname, 'venv', 'Scripts', 'python.exe');
  }
  return path.join(__dirname, 'venv', 'bin', 'python');
}

// Check if the FastAPI server is already running on the target port
function checkServerReady() {
  return new Promise((resolve) => {
    http.get(HEALTH_URL, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    }).on('error', () => {
      resolve(false);
    });
  });
}

// Spawn the Python FastAPI server
function startPythonServer() {
  const pythonPath = getPythonPath();
  console.log(`[Electron] Spawning Python backend using: ${pythonPath}`);

  pyProc = spawn(pythonPath, ['-m', 'uvicorn', 'app:app', '--host', HOST, '--port', String(PORT)], {
    cwd: __dirname,
    stdio: 'inherit', // Pipes backend stdout/stderr directly to Electron terminal log
    env: { ...process.env }
  });

  pyProc.on('error', (err) => {
    console.error('[Electron] Failed to start Python server process:', err);
  });

  pyProc.on('close', (code) => {
    console.log(`[Electron] Python server process exited with code ${code}`);
  });
}

// Wait for the FastAPI server to become healthy before opening the browser window
async function waitAndCreateFestivities() {
  let attempts = 0;
  const maxAttempts = 80; // Up to 20 seconds total (80 * 250ms)
  
  const check = async () => {
    const isReady = await checkServerReady();
    if (isReady) {
      console.log('[Electron] Python server detected healthy and responsive. Launching UI window.');
      createWindow();
    } else {
      attempts++;
      if (attempts >= maxAttempts) {
        console.error('[Electron] Server failed to become healthy. Opening browser window anyway to let user see connection status.');
        createWindow();
      } else {
        setTimeout(check, 250);
      }
    }
  };
  
  await check();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Odysseus',
    icon: path.join(__dirname, 'static', 'manifest.json'), // Set window icon when possible
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Application startup lifecycle
app.on('ready', async () => {
  const alreadyRunning = await checkServerReady();
  if (alreadyRunning) {
    console.log('[Electron] Server is already running. Linking UI window directly.');
    createWindow();
  } else {
    startPythonServer();
    await waitAndCreateFestivities();
  }
});

// Quit when all windows are closed, except on macOS (standard behavior)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up child process on exit
app.on('will-quit', () => {
  if (pyProc) {
    console.log('[Electron] Terminating Python backend subprocess...');
    pyProc.kill('SIGTERM'); // Send SIGTERM for graceful shutdown
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

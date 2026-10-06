const { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, session } = require('electron');
const http = require('http');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const cloudflare = require('./cloudflare-manager.js');

let mainWindow;
let serverOAuth = null;

const LOGO_URL = "https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg";

// ============ LOGS DEL UPDATER ============
log.transports.file.level = 'info';
autoUpdater.logger = log;

// ============ CONFIGURACIÓN DEL AUTO-UPDATER ============
autoUpdater.autoDownload = false;         // No descargar automáticamente
autoUpdater.autoInstallOnAppQuit = true;  // Instalar al cerrar la app
autoUpdater.allowDowngrade = false;       // No permitir versiones viejas
autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };
autoUpdater.forceDevUpdateConfig = false;

// ⏱️ TIMEOUT: si en 15 segundos no responde GitHub, cancelar
let updaterTimeout = null;
function iniciarTimeoutUpdater() {
  clearTimeout(updaterTimeout);
  updaterTimeout = setTimeout(() => {
    console.log('⏱️ Timeout: la búsqueda de actualizaciones tardó demasiado');
    sendToRenderer('update-status', {
      status: 'error',
      message: 'No se pudo conectar con el servidor de actualizaciones. Verifica tu conexión a internet.'
    });
  }, 15000);
}
function cancelarTimeoutUpdater() {
  clearTimeout(updaterTimeout);
  updaterTimeout = null;
}

// ============ EVENTOS DEL AUTO-UPDATER ============
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Buscando actualizaciones...');
  iniciarTimeoutUpdater();
  sendToRenderer('update-status', { status: 'checking', message: 'Buscando actualizaciones...' });
});

autoUpdater.on('update-available', (info) => {
  cancelarTimeoutUpdater();
  console.log('✅ Actualización disponible:', info.version);
  sendToRenderer('update-status', {
    status: 'available',
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes || '',
    message: `Nueva versión ${info.version} disponible`
  });
});

autoUpdater.on('update-not-available', (info) => {
  cancelarTimeoutUpdater();
  console.log('✅ No hay actualizaciones. Versión actual:', info.version);
  sendToRenderer('update-status', {
    status: 'not-available',
    version: info.version,
    message: 'Ya tienes la última versión'
  });
});

autoUpdater.on('error', (err) => {
  cancelarTimeoutUpdater();
  console.error('❌ Error en autoUpdater:', err);
  sendToRenderer('update-status', {
    status: 'error',
    message: 'Error al buscar actualizaciones: ' + (err.message || 'Desconocido')
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  const mensaje = `Descargando... ${progressObj.percent.toFixed(1)}% (${(progressObj.transferred / 1024 / 1024).toFixed(2)} MB / ${(progressObj.total / 1024 / 1024).toFixed(2)} MB)`;
  console.log('📥', mensaje);
  sendToRenderer('update-status', {
    status: 'downloading',
    percent: progressObj.percent,
    transferred: progressObj.transferred,
    total: progressObj.total,
    bytesPerSecond: progressObj.bytesPerSecond,
    message: mensaje
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('✅ Actualización descargada:', info.version);
  sendToRenderer('update-status', {
    status: 'downloaded',
    version: info.version,
    message: 'Actualización lista para instalar'
  });
});

function sendToRenderer(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

// ============ IPC: VERIFICAR ACTUALIZACIONES ============
ipcMain.handle('verificar-actualizaciones', async () => {
  try {
    console.log('🔍 Verificando actualizaciones manualmente...');
    iniciarTimeoutUpdater();
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo || null };
  } catch (err) {
    cancelarTimeoutUpdater();
    console.error('❌ Error verificando:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('descargar-actualizacion', async () => {
  try {
    console.log('📥 Iniciando descarga de actualización...');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('❌ Error descargando:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('instalar-actualizacion', async () => {
  try {
    console.log('🚀 Instalando actualización y reiniciando...');
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    console.error('❌ Error instalando:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('obtener-version-app', () => {
  return app.getVersion();
});

// ============ NOTIFICACIONES PUSH DESDE FIRESTORE ============
ipcMain.handle('mostrar-notificacion', async (event, { titulo, mensaje, icono }) => {
  try {
    if (!Notification.isSupported()) return false;
    const notif = new Notification({
      title: titulo || 'Rayito Plus',
      body: mensaje || '',
      icon: icono || path.join(__dirname, 'logo.png'),
      silent: false
    });
    notif.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    notif.show();
    return true;
  } catch (err) {
    console.error('❌ Error mostrando notificación:', err);
    return false;
  }
});

// ============ BLOQUEAR DEVTOOLS Y ATAJOS PELIGROSOS ============
function bloquearAtajosPeligrosos() {
  try {
    // F12
    globalShortcut.register('F12', () => {
      console.log('🚫 F12 bloqueado');
    });
    // Ctrl + Shift + I (DevTools)
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      console.log('🚫 Ctrl+Shift+I bloqueado');
    });
    // Ctrl + Shift + J (Consola)
    globalShortcut.register('CommandOrControl+Shift+J', () => {
      console.log('🚫 Ctrl+Shift+J bloqueado');
    });
    // Ctrl + Shift + C (Inspector de elementos)
    globalShortcut.register('CommandOrControl+Shift+C', () => {
      console.log('🚫 Ctrl+Shift+C bloqueado');
    });
    // Ctrl + U (Ver código fuente)
    globalShortcut.register('CommandOrControl+U', () => {
      console.log('🚫 Ctrl+U bloqueado');
    });
    console.log('🛡️ Atajos peligrosos bloqueados');
  } catch (err) {
    console.error('Error bloqueando atajos:', err);
  }
}

// ============ VENTANA PRINCIPAL ============
function crearVentana() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      webviewTag: true,
      devTools: false  // ✅ DevTools deshabilitadas
    }
  });

  // ✅ Eliminar el menú por completo (sin acceso a "Toggle DevTools" ni "Reload")
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile('index.html');

  // ✅ Bloquear apertura de DevTools programáticamente
  mainWindow.webContents.on('devtools-opened', () => {
    console.log('🚫 DevTools abiertas, cerrándolas...');
    mainWindow.webContents.closeDevTools();
  });

  // ✅ Bloquear teclas: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    const shift = input.shift;

    if (
      key === 'f12' ||
      (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (ctrl && key === 'u')
    ) {
      event.preventDefault();
      console.log('🚫 Atajo bloqueado:', input.key);
      return false;
    }
  });

  // ✅ Bloquear clic derecho (menú contextual)
  mainWindow.webContents.on('context-menu', (e) => {
    e.preventDefault();
  });

  // ✅ Bloquear navegación externa en la misma ventana
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // ✅ Bloquear window.open
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('🚫 window.open bloqueado:', url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============ ABRIR NAVEGADOR EXTERNO ============
function abrirEnChrome(urlDestino) {
  return new Promise((resolve) => {
    const rutasChrome = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    let chromePath = null;
    for (const ruta of rutasChrome) {
      if (fs.existsSync(ruta)) { chromePath = ruta; break; }
    }
    if (chromePath) {
      exec(`"${chromePath}" --new-window "${urlDestino}"`, (error) => {
        if (error) shell.openExternal(urlDestino).then(() => resolve(true));
        else resolve(true);
      });
    } else {
      shell.openExternal(urlDestino).then(() => resolve(true));
    }
  });
}

ipcMain.handle('abrir-navegador', async (event, url) => await abrirEnChrome(url));

ipcMain.handle('abrir-popup', async (event, { url, width, height, title }) => {
  const popup = new BrowserWindow({
    width: width || 1000,
    height: height || 700,
    title: title || 'Rayito Plus',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    parent: mainWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      devTools: false
    }
  });
  popup.setMenu(null);
  popup.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    if (key === 'f12' || (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) || (ctrl && key === 'u')) {
      event.preventDefault();
      return false;
    }
  });
  if (url.startsWith('http')) popup.loadURL(url);
  else popup.loadFile(url);
  return true;
});

// ============ IPC: PELÍCULAS / SERIES ============
ipcMain.handle('cargar-peliculas', async () => {
  try {
    const movies = await cloudflare.cargarPeliculas();
    return { success: true, data: movies };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cargar-series', async () => {
  try {
    const series = await cloudflare.cargarSeries();
    return { success: true, data: series };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ SERVIDOR OAUTH ============
ipcMain.handle('iniciar-servidor-oauth', async () => {
  return new Promise((resolve) => {
    if (serverOAuth) { serverOAuth.close(); serverOAuth = null; }
    serverOAuth = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, 'http://127.0.0.1:8765');
      if (reqUrl.pathname === '/oauth-callback') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html><head><meta charset="UTF-8"><title>Rayito Plus</title>
          <style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { background: radial-gradient(circle at center, #1a0b2e 0%, #000 80%);
              color:#fff; font-family:'Segoe UI',Arial,sans-serif;
              display:flex; flex-direction:column; align-items:center; justify-content:center;
              height:100vh; text-align:center; overflow:hidden; }
            .logo-container { width:140px; height:140px; border-radius:30px;
              background:linear-gradient(135deg,#7c3aed,#4c1d95);
              display:flex; align-items:center; justify-content:center;
              box-shadow:0 0 80px rgba(124,58,237,0.8);
              animation:pulse 2s infinite ease-in-out; margin-bottom:30px; overflow:hidden; }
            .logo-container img { width:100%; height:100%; object-fit:cover; }
            .logo-fallback { font-size:70px; color:#fff; }
            @keyframes pulse { 0%,100%{transform:scale(1);box-shadow:0 0 80px rgba(124,58,237,0.8);} 50%{transform:scale(1.08);box-shadow:0 0 120px rgba(124,58,237,1);} }
            h1 { color:#fff; font-size:42px; margin-bottom:15px; font-weight:800; letter-spacing:2px; }
            h1 span { background:linear-gradient(90deg,#a78bfa,#7c3aed); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
            p { color:#9ca3af; font-size:16px; margin-bottom:30px; }
            .check { width:60px; height:60px; border-radius:50%; background:linear-gradient(135deg,#10b981,#059669); display:flex; align-items:center; justify-content:center; font-size:30px; color:#fff; margin:0 auto 25px; box-shadow:0 0 30px rgba(16,185,129,0.6); animation:checkPop 0.6s ease; }
            @keyframes checkPop { 0%{transform:scale(0);} 50%{transform:scale(1.2);} 100%{transform:scale(1);} }
            .close-hint { margin-top:40px; padding:12px 24px; background:rgba(124,58,237,0.15); border:1px solid #7c3aed; border-radius:10px; color:#a78bfa; font-size:13px; font-weight:600; }
          </style></head><body>
            <div class="logo-container">
              <img src="${LOGO_URL}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
              <div class="logo-fallback" style="display:none;">⚡</div>
            </div>
            <h1>Rayito <span>Plus</span></h1>
            <div class="check">✓</div>
            <p>Autenticación exitosa</p>
            <div class="close-hint">🎬 Ya puedes cerrar esta ventana y volver a la app</div>
            <script>
              if (window.location.hash) {
                fetch('/recibir-hash?hash=' + encodeURIComponent(window.location.hash))
                  .then(() => setTimeout(() => window.close(), 1500));
              }
            </script>
          </body></html>
        `);
        return;
      }
      if (reqUrl.pathname === '/recibir-hash') {
        const hash = reqUrl.searchParams.get('hash');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('oauth-hash', hash);
          mainWindow.focus();
        }
        return;
      }
      res.writeHead(404); res.end('Not found');
    });
    serverOAuth.listen(8765, '127.0.0.1', () => resolve('http://127.0.0.1:8765/oauth-callback'));
  });
});

ipcMain.handle('detener-servidor-oauth', async () => {
  if (serverOAuth) { serverOAuth.close(); serverOAuth = null; }
  return true;
});

// ============ INICIO DE LA APP ============
app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.rayitoplus.rayitoplus');
  }

  // 🛡️ Activar SOLO las protecciones que NO bloquean contenido
  bloquearAtajosPeligrosos();

  crearVentana();

  // ✅ Verificar actualizaciones 3 segundos después de abrir
  setTimeout(() => {
    console.log('🔍 Verificando actualizaciones al inicio...');
    iniciarTimeoutUpdater();
    autoUpdater.checkForUpdates().catch(err => {
      cancelarTimeoutUpdater();
      console.log('⚠️ No se pudo verificar actualizaciones al inicio:', err.message);
    });
  }, 3000);
});

// 🛡️ Desregistrar atajos globales al cerrar
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (serverOAuth) serverOAuth.close();
  if (process.platform !== 'darwin') app.quit();
});
const { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, session } = require('electron');
const http = require('http');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const cloudflare = require('./cloudflare-manager.js');

// ═══════════════════════════════════════════════════════════
// OPTIMIZACIÓN: Flags de rendimiento
// ═══════════════════════════════════════════════════════════
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

app.commandLine.appendSwitch('disk-cache-size', '52428800');
app.commandLine.appendSwitch('media-cache-size', '52428800');

let mainWindow;
let serverOAuth = null;
let installInProgress = false;

const LOGO_URL = 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg';
const isDev = !app.isPackaged;

log.transports.file.level = isDev ? 'debug' : 'info';
log.transports.console.level = isDev ? 'debug' : 'info';

// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL UPDATER
// ═══════════════════════════════════════════════════════════
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;   // ✅ Instalar al cerrar si hay pendiente
autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;
autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };
autoUpdater.forceDevUpdateConfig = false;

let updaterTimeout = null;

function iniciarTimeoutUpdater() {
  clearTimeout(updaterTimeout);
  updaterTimeout = setTimeout(() => {
    sendToRenderer('update-status', {
      status: 'error',
      message: 'No se pudo conectar con el servidor de actualizaciones.',
    });
  }, 15000);
}

function cancelarTimeoutUpdater() {
  clearTimeout(updaterTimeout);
  updaterTimeout = null;
}

autoUpdater.on('checking-for-update', () => {
  log.info('🔍 [updater] Buscando actualizaciones...');
  iniciarTimeoutUpdater();
  sendToRenderer('update-status', { status: 'checking', message: 'Buscando actualizaciones...' });
});

autoUpdater.on('update-available', (info) => {
  log.info('🎉 [updater] Actualización disponible:', info.version);
  cancelarTimeoutUpdater();
  sendToRenderer('update-status', {
    status: 'available',
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes || '',
    message: `Nueva versión ${info.version} disponible`,
  });
});

autoUpdater.on('update-not-available', (info) => {
  log.info('✅ [updater] Ya estás en la última versión');
  cancelarTimeoutUpdater();
  sendToRenderer('update-status', {
    status: 'not-available',
    version: info.version,
    message: 'Ya tienes la última versión',
  });
});

autoUpdater.on('error', (err) => {
  log.error('❌ [updater] Error:', err.message);
  cancelarTimeoutUpdater();
  sendToRenderer('update-status', {
    status: 'error',
    message: 'Error al buscar actualizaciones: ' + (err.message || 'Desconocido'),
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  const msg = `Descargando... ${progressObj.percent.toFixed(1)}%`;
  log.info(`⬇️ [updater] ${msg}`);
  sendToRenderer('update-status', {
    status: 'downloading',
    percent: progressObj.percent,
    transferred: progressObj.transferred,
    total: progressObj.total,
    bytesPerSecond: progressObj.bytesPerSecond,
    message: msg,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('✅ [updater] Actualización descargada:', info.version);
  log.info('📁 [updater] Instalador guardado en caché del updater');
  sendToRenderer('update-status', {
    status: 'downloaded',
    version: info.version,
    message: 'Actualización lista para instalar',
  });
});

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    try {
      mainWindow.webContents.send(channel, data);
    } catch (e) {
      log.error('Error enviando a renderer:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// HANDLERS DE IPC
// ═══════════════════════════════════════════════════════════

ipcMain.handle('verificar-actualizaciones', async () => {
  try {
    iniciarTimeoutUpdater();
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo || null };
  } catch (err) {
    cancelarTimeoutUpdater();
    log.error('Error verificando:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('descargar-actualizacion', async () => {
  try {
    log.info('⬇️ [updater] Iniciando descarga...');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    log.error('Error descargando:', err);
    return { success: false, error: err.message };
  }
});

// ═══════════════════════════════════════════════════════════
// 🚀 INSTALACIÓN DE ACTUALIZACIÓN — VERSIÓN CORREGIDA
// ═══════════════════════════════════════════════════════════
ipcMain.handle('instalar-actualizacion', async () => {
  if (installInProgress) {
    log.warn('⚠️ [install] Ya hay una instalación en progreso');
    return { success: true, message: 'Ya en progreso' };
  }

  installInProgress = true;
  log.info('═══════════════════════════════════════════');
  log.info('🚀 [install] INICIANDO INSTALACIÓN');
  log.info('═══════════════════════════════════════════');

  try {
    // 1. Detener servidor OAuth
    if (serverOAuth) {
      try {
        serverOAuth.close();
        log.info('✅ [install] Servidor OAuth cerrado');
      } catch (e) {
        log.warn('Error cerrando OAuth:', e);
      }
      serverOAuth = null;
    }

    // 2. Limpiar Firebase
    try {
      const { getApps } = require('firebase/app');
      const apps = getApps();
      for (const a of apps) {
        try { await a.delete(); } catch (e) {}
      }
      log.info('✅ [install] Firebase limpiado');
    } catch (e) {
      log.warn('Error limpiando Firebase:', e);
    }

    // 3. Verificar si el instalador está descargado
    const updateCacheDir = path.join(
      process.env.LOCALAPPDATA,
      'rayito-exe-updater',
      'pending'
    );
    log.info('📁 [install] Buscando instalador en:', updateCacheDir);

    let installerPath = null;
    if (fs.existsSync(updateCacheDir)) {
      const files = fs.readdirSync(updateCacheDir);
      const installer = files.find(f =>
        f.endsWith('.exe') && f.includes('RayitoPlus-Setup')
      );
      if (installer) {
        installerPath = path.join(updateCacheDir, installer);
        const stats = fs.statSync(installerPath);
        log.info('✅ [install] Instalador encontrado:', installerPath);
        log.info('📦 [install] Tamaño:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
      }
    }

    if (!installerPath) {
      log.warn('⚠️ [install] Instalador no encontrado, usando quitAndInstall');
    }

    // 4. Cerrar ventanas SIN destruirlas (quitAndInstall se encarga)
    //    Enviamos evento al renderer para que cierre limpiamente
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('preparando-instalacion');
        log.info('✅ [install] Notificado al renderer');
      } catch (e) {}
    }

    // 5. Esperar un momento para que se limpie todo
    await new Promise(r => setTimeout(r, 800));

    // ═══════════════════════════════════════════════════════
    // MÉTODO PRINCIPAL: autoUpdater.quitAndInstall
    // Parámetros: (isSilent, isForceRunAfter)
    // - isSilent = false  → Muestra el instalador
    // - isForceRunAfter = true → Reabre la app después de instalar
    // ═══════════════════════════════════════════════════════
    log.info('🚀 [install] Llamando autoUpdater.quitAndInstall(false, true)...');

    // setImmediate asegura que el IPC responda ANTES de cerrar
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
        log.info('✅ [install] quitAndInstall ejecutado');
      } catch (err) {
        log.error('❌ [install] Error en quitAndInstall:', err);
      }
    });

    // ═══════════════════════════════════════════════════════
    // FALLBACK: Si en 4 segundos la app sigue viva, forzar ejecución
    // ═══════════════════════════════════════════════════════
    setTimeout(() => {
      if (installInProgress) {
        log.warn('⚠️ [install] Fallback activado — forzando instalación manual');

        if (installerPath && fs.existsSync(installerPath)) {
          try {
            log.info('🚀 [install] Ejecutando instalador manualmente:', installerPath);

            const child = spawn(installerPath, ['/S', '--force-run'], {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            });
            child.unref();

            log.info('✅ [install] Instalador lanzado, cerrando app en 1s...');
            setTimeout(() => app.exit(0), 1000);
          } catch (err) {
            log.error('❌ [install] Error ejecutando instalador:', err);
            app.exit(0);
          }
        } else {
          log.error('❌ [install] No hay instalador para ejecutar, cerrando app');
          app.exit(0);
        }
      }
    }, 4000);

    return { success: true };

  } catch (err) {
    log.error('❌ [install] Error general:', err);
    installInProgress = false;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('obtener-version-app', () => app.getVersion());

ipcMain.handle('mostrar-notificacion', async (_event, { titulo, mensaje, icono }) => {
  try {
    if (!Notification.isSupported()) return false;
    const notif = new Notification({
      title: titulo || 'Rayito Plus',
      body: mensaje || '',
      icon: icono || path.join(__dirname, 'logo.png'),
      silent: false,
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
    log.error('Error mostrando notificación:', err);
    return false;
  }
});

function bloquearAtajosPeligrosos() {
  try {
    globalShortcut.register('F12', () => {});
    globalShortcut.register('CommandOrControl+Shift+I', () => {});
    globalShortcut.register('CommandOrControl+Shift+J', () => {});
    globalShortcut.register('CommandOrControl+Shift+C', () => {});
    globalShortcut.register('CommandOrControl+U', () => {});
  } catch (err) {
    log.error('Error bloqueando atajos:', err);
  }
}

function crearVentana() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      webviewTag: true,
      devTools: isDev,
      sandbox: false,
      spellcheck: false,
      enableRemoteModule: false,
      backgroundThrottling: true,
      v8CacheOptions: 'code',
    },
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    log.info('✅ index.html cargado');
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    log.error('❌ Error al cargar index.html:', code, desc);
  });

  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isDev) {
      const key = (input.key || '').toLowerCase();
      const ctrl = input.control || input.meta;
      const shift = input.shift;
      if (
        key === 'f12' ||
        (ctrl && shift && (key === 'i' || key === 'j' || key === 'c')) ||
        (ctrl && key === 'u')
      ) {
        event.preventDefault();
        return false;
      }
    }
  });

  mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'fullscreen', 'notifications'];
    callback(allowed.includes(permission));
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function abrirEnChrome(urlDestino) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(urlDestino)) { resolve(false); return; }
    const rutasChrome = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
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

ipcMain.handle('abrir-navegador', async (_event, url) => {
  if (typeof url !== 'string' || url.length > 2048) return false;
  return await abrirEnChrome(url);
});

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

ipcMain.handle('iniciar-servidor-oauth', async () => {
  return new Promise((resolve) => {
    if (serverOAuth) { serverOAuth.close(); serverOAuth = null; }

    serverOAuth = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, 'http://127.0.0.1:8765');

      if (reqUrl.pathname === '/oauth-callback') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Rayito Plus</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:radial-gradient(circle at center,#1a0b2e 0%,#000 80%);color:#fff;font-family:'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;overflow:hidden}
.logo-container{width:140px;height:140px;border-radius:30px;background:linear-gradient(135deg,#7c3aed,#4c1d95);display:flex;align-items:center;justify-content:center;box-shadow:0 0 80px rgba(124,58,237,.8);animation:pulse 2s infinite ease-in-out;margin-bottom:30px;overflow:hidden}
.logo-container img{width:100%;height:100%;object-fit:cover}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
h1{color:#fff;font-size:42px;margin-bottom:15px;font-weight:800}
h1 span{background:linear-gradient(90deg,#a78bfa,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#9ca3af;font-size:16px;margin-bottom:30px}
.check{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;font-size:30px;color:#fff;margin:0 auto 25px}
.close-hint{margin-top:40px;padding:12px 24px;background:rgba(124,58,237,.15);border:1px solid #7c3aed;border-radius:10px;color:#a78bfa;font-size:13px;font-weight:600}
</style></head><body>
<div class="logo-container"><img src="${LOGO_URL}"></div>
<h1>Rayito <span>Plus</span></h1>
<div class="check">✓</div>
<p>Autenticación exitosa</p>
<div class="close-hint">🎬 Ya puedes cerrar esta ventana</div>
<script>
if(window.location.hash){fetch('/recibir-hash?hash='+encodeURIComponent(window.location.hash)).then(()=>setTimeout(()=>window.close(),1500));}
</script>
</body></html>`);
        return;
      }

      if (reqUrl.pathname === '/recibir-hash') {
        const hash = reqUrl.searchParams.get('hash');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('oauth-hash', hash);
          mainWindow.focus();
        }
        return;
      }

      res.writeHead(404); res.end('Not found');
    });

    serverOAuth.listen(8765, '127.0.0.1', () => {
      resolve('http://127.0.0.1:8765/oauth-callback');
    });
  });
});

ipcMain.handle('detener-servidor-oauth', async () => {
  if (serverOAuth) { serverOAuth.close(); serverOAuth = null; }
  return true;
});

// ═══════════════════════════════════════════════════════════
// INICIO DE LA APP
// ═══════════════════════════════════════════════════════════
app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.rayitoplus.rayitoplus');
  }

  bloquearAtajosPeligrosos();
  crearVentana();

  setTimeout(() => {
    log.info('🔍 Verificando actualizaciones al inicio...');
    iniciarTimeoutUpdater();
    autoUpdater.checkForUpdates().catch((err) => {
      cancelarTimeoutUpdater();
      log.warn('⚠️ No se pudo verificar:', err.message);
    });
  }, 10000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (serverOAuth) serverOAuth.close();
  if (process.platform !== 'darwin') app.quit();
});
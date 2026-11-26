// C:\Me\AppMoney\MeParisPortifs\main.js
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');

// ⭐ 1. Nettoyage : Force le stockage temporaire dans le dossier TEMP de Windows
app.setPath('userData', path.join(app.getPath('temp'), 'Me23LegendTemp'));

// ⭐ 2. Lancement du serveur Node.js (Express + Neon DB)
process.env.PORT = 3000;
try {
  require('./server.js');
  console.log('[Electron] Serveur Node.js démarré en arrière-plan.');
} catch (error) {
  console.error('[Electron] Erreur fatale au démarrage du serveur :', error);
}

// ⭐ 3. Fonction pour attendre que le serveur soit prêt (polling)
function waitForServer(callback, retries = 30) {
  const req = http.get('http://127.0.0.1:3000/api/health', (res) => {
    if (res.statusCode === 200) {
      callback(); // Le serveur est prêt !
    } else {
      retry();
    }
  }).on('error', () => {
    retry();
  });

  function retry() {
    if (retries <= 0) {
      callback(new Error('Timeout')); // Abandon après 15 secondes
    } else {
      setTimeout(() => waitForServer(callback, retries - 1), 500);
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Me2/3Legend",
    webPreferences: {
      nodeIntegration: false, 
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(null);

  // Affichage immédiat d'un écran de chargement
  win.loadURL(`data:text/html;charset=utf-8,<div style="display:flex;justify-content:center;align-items:center;height:100vh;background:#0d0d18;color:#7c3aed;font-family:sans-serif;flex-direction:column;">
    <div style="border:4px solid #333;border-top:4px solid #7c3aed;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;"></div>
    <h2 style="margin-top:20px;">Démarrage de Me2/3Legend...</h2>
    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
  </div>`);

  // On attend que le serveur soit prêt
  waitForServer((err) => {
    if (err) {
      // Erreur après 15s
      win.loadURL(`data:text/html;charset=utf-8,<div style="padding:50px;text-align:center;font-family:sans-serif;background:#0d0d18;color:#fff;height:100vh;">
        <h2 style="color:#ef4444;">Erreur de connexion</h2>
        <p>L'application n'a pas pu joindre la base de données à temps.</p>
        <p>Vérifiez votre connexion Internet.</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:10px 20px;border:none;border-radius:8px;background:#7c3aed;color:white;cursor:pointer;font-weight:bold;">Réessayer</button>
      </div>`);
    } else {
      // Succès : On charge le site
      win.loadURL('http://127.0.0.1:3000');
    }
  });
  
  // Ouvrir les liens externes (CinetPay) dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
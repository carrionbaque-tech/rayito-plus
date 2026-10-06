const { firebaseConfig } = require('./firebase-config.js');
const { initializeApp } = require('firebase/app');
const {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithCredential, updateProfile
} = require('firebase/auth');
const { getDatabase, ref, set, get, push } = require('firebase/database');
const {
  getFirestore, collection, doc, addDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, getDoc, collectionGroup,
  onSnapshot, updateDoc
} = require('firebase/firestore');
const { ipcRenderer } = require('electron');
const Hls = require('hls.js');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const firestore = getFirestore(app);

let PELICULAS = [];
let SERIES = [];
let VISTA_ACTUAL = { tipo: 'home' };
let heroActualIndex = 0;
let heroInterval = null;
let CONFIG_USUARIO = {
  autoplay: true,
  notificaciones: true,
  calidad: 'auto'
};

// ============ HELPERS ============
function getCategoriaNombre(cat) {
  const map = {
    featured: 'Destacada', action: 'Acción', animation: 'Animación',
    romance: 'Romance', horror: 'Terror', real_events: 'Navidad',
    christian: 'Cristiana'
  };
  return map[cat] || (cat || 'Película');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============ SPLASH ============
window.addEventListener('load', () => {
  setTimeout(() => {
    const splash = document.getElementById('splash');
    if (splash) { splash.classList.add('fade-out'); setTimeout(() => splash.remove(), 800); }
  }, 2500);
});

// ============ CONFIG ============
function cargarConfig() {
  try {
    const saved = localStorage.getItem('config_rayito');
    if (saved) CONFIG_USUARIO = { ...CONFIG_USUARIO, ...JSON.parse(saved) };
  } catch (e) {}
}
function guardarConfig() { localStorage.setItem('config_rayito', JSON.stringify(CONFIG_USUARIO)); }
cargarConfig();

// ============ NOTIFICACIONES ============
async function mostrarNotificacion(titulo, mensaje, icono) {
  if (!CONFIG_USUARIO.notificaciones) return;
  try {
    await ipcRenderer.invoke('mostrar-notificacion', {
      titulo, mensaje, icono: icono || "https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg"
    });
  } catch (e) {}
}

// ============ AUTH ============
const pantallas = {
  login: document.getElementById('pantalla-login'),
  registro: document.getElementById('pantalla-registro'),
  forgot: document.getElementById('pantalla-forgot')
};
function mostrarPantalla(nombre) {
  Object.values(pantallas).forEach(p => p.classList.add('hidden'));
  pantallas[nombre].classList.remove('hidden');
  limpiarErrores();
}
function limpiarErrores() {
  document.getElementById('login-error').textContent = '';
  document.getElementById('register-error').textContent = '';
  document.getElementById('forgot-error').textContent = '';
  document.getElementById('forgot-success').textContent = '';
}
document.getElementById('link-register').addEventListener('click', () => mostrarPantalla('registro'));
document.getElementById('link-login').addEventListener('click', () => mostrarPantalla('login'));
document.getElementById('link-forgot').addEventListener('click', () => mostrarPantalla('forgot'));
document.getElementById('link-back-login').addEventListener('click', () => mostrarPantalla('login'));

function traducirError(code) {
  const e = {
    'auth/email-already-in-use': 'Ese correo ya está registrado',
    'auth/invalid-email': 'Correo inválido',
    'auth/weak-password': 'Mínimo 6 caracteres',
    'auth/user-not-found': 'No existe esa cuenta',
    'auth/wrong-password': 'Contraseña incorrecta',
    'auth/invalid-credential': 'Datos incorrectos',
    'auth/too-many-requests': 'Demasiados intentos'
  };
  return e[code] || 'Error: ' + code;
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  if (!email || !password) { errorEl.textContent = 'Completa todos los campos'; return; }
  errorEl.textContent = 'Iniciando sesión...';
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (err) { errorEl.textContent = traducirError(err.code); }
});

document.getElementById('btn-register').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  const errorEl = document.getElementById('register-error');
  if (!username || !email || !password || !confirm) { errorEl.textContent = 'Completa todos los campos'; return; }
  if (username.length < 3) { errorEl.textContent = 'Mínimo 3 caracteres'; return; }
  if (password.length < 6) { errorEl.textContent = 'Mínimo 6 caracteres'; return; }
  if (password !== confirm) { errorEl.textContent = 'No coinciden'; return; }
  errorEl.textContent = 'Creando cuenta...';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: username });
    await set(ref(db, 'users/' + cred.user.uid), {
      userId: cred.user.uid, username, name: username, email,
      photoBase64: '', online: true, lastSeen: Date.now(),
      createdAt: Date.now(), lastUsernameChange: 0
    });
    mostrarNotificacion('¡Bienvenido!', 'Tu cuenta ha sido creada exitosamente');
  } catch (err) { errorEl.textContent = traducirError(err.code); }
});

document.getElementById('btn-forgot').addEventListener('click', async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const errorEl = document.getElementById('forgot-error');
  const successEl = document.getElementById('forgot-success');
  if (!email) { errorEl.textContent = 'Ingresa tu correo'; return; }
  errorEl.textContent = ''; successEl.textContent = 'Enviando...';
  try {
    await sendPasswordResetEmail(auth, email);
    successEl.textContent = '✅ Enlace enviado';
    document.getElementById('forgot-email').value = '';
  } catch (err) { successEl.textContent = ''; errorEl.textContent = traducirError(err.code); }
});

async function loginConGoogle() {
  const errorEl = !document.getElementById('pantalla-login').classList.contains('hidden')
    ? document.getElementById('login-error') : document.getElementById('register-error');
  errorEl.textContent = 'Abriendo Google...';
  try {
    const redirectUri = await ipcRenderer.invoke('iniciar-servidor-oauth');
    const clientId = "553262546007-jfslm46t3ag3vs71u63vo8k40bt3s6lc.apps.googleusercontent.com";
    const nonce = Math.random().toString(36).substring(2, 15);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=id_token&scope=${encodeURIComponent('email profile openid')}&nonce=${nonce}&prompt=select_account`;
    await ipcRenderer.invoke('abrir-navegador', authUrl);
    errorEl.textContent = 'Esperando autenticación...';
  } catch (err) { errorEl.textContent = 'Error: ' + err.message; }
}

ipcRenderer.on('oauth-hash', async (event, hash) => {
  const errorEl = !document.getElementById('pantalla-login').classList.contains('hidden')
    ? document.getElementById('login-error') : document.getElementById('register-error');
  try {
    const params = new URLSearchParams(hash.substring(1));
    const idToken = params.get('id_token');
    if (!idToken) throw new Error('Sin id_token');
    const credential = GoogleAuthProvider.credential(idToken);
    const result = await signInWithCredential(auth, credential);
    const user = result.user;
    const userRef = ref(db, 'users/' + user.uid);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      await set(userRef, {
        userId: user.uid, username: user.displayName || user.email.split('@')[0],
        name: user.displayName || user.email.split('@')[0], email: user.email,
        photoBase64: user.photoURL || '', online: true,
        lastSeen: Date.now(), createdAt: Date.now(), lastUsernameChange: 0
      });
    }
    errorEl.textContent = '';
    await ipcRenderer.invoke('detener-servidor-oauth');
  } catch (err) { errorEl.textContent = 'Error: ' + err.message; }
});

document.getElementById('btn-google-login').addEventListener('click', loginConGoogle);
document.getElementById('btn-google-register').addEventListener('click', loginConGoogle);

async function cerrarSesion() {
  const user = auth.currentUser;
  if (user) {
    try {
      await set(ref(db, 'users/' + user.uid + '/online'), false);
      await set(ref(db, 'users/' + user.uid + '/lastSeen'), Date.now());
    } catch (e) {}
  }
  await signOut(auth);
}

onAuthStateChanged(auth, async (user) => {
  const authContainer = document.getElementById('auth-container');
  const appContainer = document.getElementById('app');
  setTimeout(async () => {
    if (user) {
      authContainer.classList.add('hidden');
      appContainer.classList.remove('hidden');
      try {
        await set(ref(db, 'users/' + user.uid + '/online'), true);
        await set(ref(db, 'users/' + user.uid + '/lastSeen'), Date.now());
      } catch (e) {}
      document.getElementById('cuenta-nombre').textContent = user.displayName || 'Usuario';
      document.getElementById('cuenta-email').textContent = user.email;
      if (user.photoURL) document.getElementById('cuenta-avatar').src = user.photoURL;

      await cargarTodoElContenido();
      mostrarHome();
    } else {
      appContainer.classList.add('hidden');
      authContainer.classList.remove('hidden');
      mostrarPantalla('login');
    }
  }, 2600);
});

// ============ CARGA ============
const dynamicContent = document.getElementById('dynamic-content');
const loader = document.getElementById('loader');
function mostrarLoader(show) {
  if (show) loader.classList.remove('hidden');
  else loader.classList.add('hidden');
}

async function cargarTodoElContenido() {
  mostrarLoader(true);
  try {
    const [resM, resS] = await Promise.all([
      ipcRenderer.invoke('cargar-peliculas'),
      ipcRenderer.invoke('cargar-series')
    ]);
    if (resM && resM.success && Array.isArray(resM.data)) {
      PELICULAS = resM.data.filter(m => {
        if (!m) return false;
        const tipo = (m.type || '').toString().toLowerCase();
        const cat = (m.category || '').toString().toLowerCase();
        return !(tipo === 'banner' || cat === 'banner');
      });
    }
    if (resS && resS.success && Array.isArray(resS.data)) SERIES = resS.data;
    console.log('✅ Cargado:', PELICULAS.length, 'pelis,', SERIES.length, 'series');
  } catch (e) { console.error(e); }
  mostrarLoader(false);
}

// ============ HOME ============
function mostrarHome() {
  VISTA_ACTUAL = { tipo: 'home' };
  detenerHeroSlider();

  if (PELICULAS.length === 0) {
    dynamicContent.innerHTML = `<div class="empty-state" style="text-align:center;padding:80px 20px;">
      <i class="fa-solid fa-triangle-exclamation" style="font-size:60px;color:#ef4444;margin-bottom:20px;"></i>
      <h3 style="color:#fff;font-size:22px;">No hay películas disponibles</h3>
    </div>`;
    return;
  }

  const yearActual = new Date().getFullYear();
  const destacadas = PELICULAS.filter(m => {
    const cat = (m.category || '').toLowerCase();
    return cat === 'featured' || m.year === yearActual;
  }).sort(() => Math.random() - 0.5).slice(0, 5);
  const heroPeliculas = destacadas.length > 0 ? destacadas : PELICULAS.slice(0, 5);

  const cats = {
    featured: { titulo: 'Destacadas', icono: 'fa-star', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'featured') },
    year: { titulo: 'Estrenos ' + yearActual, icono: 'fa-calendar-star', items: PELICULAS.filter(m => m.year === yearActual) },
    action: { titulo: 'Acción', icono: 'fa-fire', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'action') },
    animation: { titulo: 'Animación', icono: 'fa-palette', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'animation') },
    romance: { titulo: 'Romance', icono: 'fa-heart', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'romance') },
    horror: { titulo: 'Terror', icono: 'fa-ghost', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'horror') },
    real_events: { titulo: 'Navidad', icono: 'fa-tree', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'real_events') },
    christian: { titulo: 'Cristianas', icono: 'fa-cross', items: PELICULAS.filter(m => (m.category||'').toLowerCase() === 'christian') }
  };

  let html = '';
  if (heroPeliculas.length > 0) {
    html += `
      <div class="hero-slider" id="hero-slider">
        ${heroPeliculas.map((m, i) => renderHeroSlide(m, i === 0)).join('')}
        <div class="hero-dots">
          ${heroPeliculas.map((_, i) => `<div class="hero-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>`).join('')}
        </div>
      </div>`;
  }

  for (const key in cats) {
    const cat = cats[key];
    if (cat.items.length === 0) continue;
    let items = cat.items;
    if (key === 'featured') {
      items = cat.items.filter(m => !heroPeliculas.find(h => h.id === m.id));
      if (items.length === 0) continue;
    }
    const preview = items.slice(0, 15);
    html += `
      <div class="slider-seccion">
        <div class="slider-header">
          <h2 class="slider-titulo"><i class="fa-solid ${cat.icono}"></i> ${cat.titulo} <span class="slider-count">(${items.length})</span></h2>
          ${items.length > 15 ? `<div class="slider-ver-mas" data-cat="${key}" data-titulo="${cat.titulo}">Ver más <i class="fa-solid fa-arrow-right"></i></div>` : ''}
        </div>
        <div class="slider-container">
          <button class="slider-arrow left"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="slider-track">${preview.map(m => renderCardPelicula(m)).join('')}</div>
          <button class="slider-arrow right"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
      </div>`;
  }

  dynamicContent.innerHTML = html;
  document.querySelectorAll('.slider-ver-mas').forEach(btn => {
    btn.addEventListener('click', () => mostrarCategoriaCompleta(btn.dataset.cat, btn.dataset.titulo));
  });
  document.querySelectorAll('.slider-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const track = arrow.parentElement.querySelector('.slider-track');
      const scrollAmount = track.clientWidth * 0.8;
      if (arrow.classList.contains('left')) track.scrollLeft -= scrollAmount;
      else track.scrollLeft += scrollAmount;
    });
  });
  if (heroPeliculas.length > 0) {
    bindHeroListeners(heroPeliculas);
    iniciarHeroSlider(heroPeliculas.length);
  }
  bindPeliculaCards();
}

function renderHeroSlide(m, isActive) {
  const bg = m.backgroundImageUrl || m.imageUrl || m.image || 'https://via.placeholder.com/1280x720/1a0b2e/a78bfa?text=Sin+Imagen';
  const titulo = m.title || 'Sin título';
  const year = m.year || '—';
  const rating = m.rating ? m.rating.toFixed(1) : '—';
  const duration = m.duration || '—';
  const categoria = getCategoriaNombre(m.category);
  const desc = (m.description || 'Sin descripción').substring(0, 200);

  return `
    <div class="hero-slide ${isActive ? 'active' : ''}" style="background-image:url('${bg}')" data-id="${m.id}">
      <div class="hero-content">
        <div class="hero-tag"><i class="fa-solid fa-fire"></i> ${categoria}</div>
        <h1 class="hero-title">${titulo}</h1>
        <div class="hero-meta">
          <span><i class="fa-solid fa-calendar"></i> ${year}</span>
          <span><i class="fa-solid fa-clock"></i> ${duration}</span>
          <span class="hero-rating"><i class="fa-solid fa-star"></i> ${rating}</span>
        </div>
        <p class="hero-desc">${desc}</p>
        <div class="hero-buttons">
          <button class="hero-btn-play" data-play="${m.id}"><i class="fa-solid fa-play"></i> Reproducir</button>
          <button class="hero-btn-info" data-info="${m.id}"><i class="fa-solid fa-circle-info"></i> Más información</button>
        </div>
      </div>
    </div>`;
}

function bindHeroListeners(peliculas) {
  document.querySelectorAll('[data-play]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = peliculas.find(x => x.id === btn.dataset.play);
      if (m && m.videoUrl) abrirReproductor(m.videoUrl, m.title, false);
      else if (m) mostrarDetallePelicula(m);
    });
  });
  document.querySelectorAll('[data-info]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = peliculas.find(x => x.id === btn.dataset.info);
      if (m) mostrarDetallePelicula(m);
    });
  });
  document.querySelectorAll('.hero-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      cambiarHeroSlide(parseInt(dot.dataset.index));
      detenerHeroSlider();
      iniciarHeroSlider(peliculas.length);
    });
  });
}

function cambiarHeroSlide(index) {
  document.querySelectorAll('.hero-slide').forEach((s, i) => s.classList.toggle('active', i === index));
  document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === index));
  heroActualIndex = index;
}
function iniciarHeroSlider(total) {
  detenerHeroSlider();
  heroInterval = setInterval(() => {
    heroActualIndex = (heroActualIndex + 1) % total;
    cambiarHeroSlide(heroActualIndex);
  }, 6000);
}
function detenerHeroSlider() { if (heroInterval) { clearInterval(heroInterval); heroInterval = null; } }

function renderCardPelicula(m) {
  const img = m.imageUrl || m.image || 'https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen';
  const titulo = m.title || 'Sin título';
  const year = m.year || '';
  const rating = m.rating ? m.rating.toFixed(1) : '—';
  return `
    <div class="pelicula-card" data-id="${m.id}">
      <div class="pelicula-poster">
        <img src="${img}" alt="${titulo}" onerror="this.src='https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen'">
        <div class="pelicula-overlay">
          <div class="pelicula-overlay-play"><i class="fa-solid fa-play"></i></div>
          <div class="pelicula-overlay-rating"><i class="fa-solid fa-star"></i> ${rating}</div>
        </div>
      </div>
      <div class="pelicula-info">
        <h4>${titulo}</h4>
        <div class="pelicula-info-row">
          <span class="pelicula-info-year">${year}</span>
          <span class="pelicula-info-rating"><i class="fa-solid fa-star"></i> ${rating}</span>
        </div>
      </div>
    </div>`;
}

function bindPeliculaCards() {
  document.querySelectorAll('.pelicula-card').forEach(card => {
    card.addEventListener('click', () => {
      const movie = PELICULAS.find(m => m.id === card.dataset.id);
      if (movie) mostrarDetallePelicula(movie);
    });
  });
}

function mostrarCategoriaCompleta(catKey, titulo) {
  const yearActual = new Date().getFullYear();
  let items = [];
  if (catKey === 'year') items = PELICULAS.filter(m => m.year === yearActual);
  else if (catKey === 'featured') items = PELICULAS.filter(m => (m.category||'').toLowerCase() === 'featured');
  else items = PELICULAS.filter(m => (m.category||'').toLowerCase() === catKey);

  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">${titulo} <span style="color:#6b7280;font-size:18px;">(${items.length})</span></h2>
      </div>
      <div class="grid-completo">${items.map(m => renderCardPelicula(m)).join('')}</div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  bindPeliculaCards();
}

// ============ DETALLE PELÍCULA ============
async function mostrarDetallePelicula(movie) {
  VISTA_ACTUAL = { tipo: 'detalle', pelicula: movie };
  detenerHeroSlider();

  const img = movie.imageUrl || movie.image || 'https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen';
  const bg = movie.backgroundImageUrl || movie.imageUrl || movie.image || img;
  const titulo = movie.title || 'Sin título';
  const year = movie.year || '—';
  const rating = movie.rating ? movie.rating.toFixed(1) : '—';
  const duration = movie.duration || '—';
  const director = movie.director || '—';
  const categoria = getCategoriaNombre(movie.category);
  const descripcion = movie.description || 'Sin descripción disponible.';

  const recomendadas = PELICULAS
    .filter(m => m.category === movie.category && m.id !== movie.id)
    .sort(() => Math.random() - 0.5).slice(0, 12);

  const user = auth.currentUser;
  const enLista = user ? await estaEnLista(user.uid, movie.id, 'mi_lista') : false;
  const enFavoritos = user ? await estaEnLista(user.uid, movie.id, 'favoritos') : false;

  dynamicContent.innerHTML = `
    <div class="detalle-container">
      <div class="detalle-hero" style="background-image:url('${bg}')">
        <div class="detalle-hero-content">
          <img src="${img}" alt="${titulo}" class="detalle-poster" onerror="this.src='https://via.placeholder.com/220x330/1a0b2e/a78bfa?text=Sin+Imagen'">
          <div class="detalle-hero-info">
            <h1 class="detalle-titulo">${titulo}</h1>
            <div class="detalle-meta">
              ${categoria ? `<span class="badge-cat">${categoria}</span>` : ''}
              <span><i class="fa-solid fa-calendar"></i> ${year}</span>
              <span><i class="fa-solid fa-clock"></i> ${duration}</span>
              <span class="badge-rating"><i class="fa-solid fa-star"></i> ${rating}</span>
            </div>
            <div class="detalle-botones">
              <button class="btn-play-grande" id="btn-reproducir-detalle"><i class="fa-solid fa-play"></i> Reproducir</button>
              <button class="btn-lista ${enLista ? 'active' : ''}" id="btn-mi-lista"><i class="fa-solid fa-${enLista ? 'check' : 'plus'}"></i> ${enLista ? 'En Mi Lista' : 'Mi Lista'}</button>
              <button class="btn-favorito ${enFavoritos ? 'active' : ''}" id="btn-favorito"><i class="fa-${enFavoritos ? 'solid' : 'regular'} fa-heart"></i> ${enFavoritos ? 'En Favoritos' : 'Favorito'}</button>
              <button class="btn-secundario" id="btn-volver-detalle"><i class="fa-solid fa-arrow-left"></i> Volver</button>
            </div>
          </div>
        </div>
      </div>

      <div class="detalle-body">
        <div class="detalle-info-grid">
          <div class="detalle-info-item"><span class="label">Director</span><span class="value">${director}</span></div>
          <div class="detalle-info-item"><span class="label">Año</span><span class="value">${year}</span></div>
          <div class="detalle-info-item"><span class="label">Duración</span><span class="value">${duration}</span></div>
          <div class="detalle-info-item"><span class="label">Categoría</span><span class="value">${categoria}</span></div>
        </div>

        <div class="detalle-seccion">
          <h3>Sinopsis</h3>
          <p>${descripcion}</p>
        </div>

        <div class="detalle-seccion comentarios-seccion">
          <h3><i class="fa-solid fa-comments"></i> Comentarios (<span id="comentarios-count">0</span>)</h3>
          <div class="comentario-form">
            <img id="comentario-avatar" src="${user?.photoURL || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'}" class="comentario-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
            <div class="comentario-input-wrapper">
              <input type="text" id="comentario-input" placeholder="Escribe un comentario..." maxlength="300">
              <button id="btn-enviar-comentario"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
          </div>
          <div id="comentarios-lista" class="comentarios-lista"><p style="color:#6b7280;text-align:center;padding:20px;">Cargando comentarios...</p></div>
        </div>
      </div>

      ${recomendadas.length > 0 ? `
        <h2 class="recomendadas-titulo"><i class="fa-solid fa-thumbs-up"></i> También te puede gustar</h2>
        <div class="slider-container" style="margin: 0 25px 50px;">
          <button class="slider-arrow left"><i class="fa-solid fa-chevron-left"></i></button>
          <div class="slider-track">${recomendadas.map(m => renderCardPelicula(m)).join('')}</div>
          <button class="slider-arrow right"><i class="fa-solid fa-chevron-right"></i></button>
        </div>` : ''}
    </div>`;

  document.getElementById('btn-volver-detalle').addEventListener('click', mostrarHome);
  document.getElementById('btn-reproducir-detalle').addEventListener('click', () => {
    if (movie.videoUrl) abrirReproductor(movie.videoUrl, titulo, false);
    else alert('Esta película no tiene video disponible');
  });
  document.getElementById('btn-mi-lista').addEventListener('click', () => toggleLista(movie, 'mi_lista'));
  document.getElementById('btn-favorito').addEventListener('click', () => toggleLista(movie, 'favoritos'));
  document.getElementById('btn-enviar-comentario').addEventListener('click', () => enviarComentarioFirestore(movie));
  document.getElementById('comentario-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarComentarioFirestore(movie);
  });
  document.querySelectorAll('.slider-arrow').forEach(arrow => {
    arrow.addEventListener('click', () => {
      const track = arrow.parentElement.querySelector('.slider-track');
      const scrollAmount = track.clientWidth * 0.8;
      if (arrow.classList.contains('left')) track.scrollLeft -= scrollAmount;
      else track.scrollLeft += scrollAmount;
    });
  });
  bindPeliculaCards();
  await cargarComentariosFirestore(movie);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ============ COMENTARIOS ============
async function cargarComentariosFirestore(movie) {
  const movieId = movie.id;
  const movieTitle = movie.title || movie.id;

  console.log('🔍 Cargando comentarios para:', movieTitle, '(id:', movieId + ')');

  const lista = document.getElementById('comentarios-lista');
  const count = document.getElementById('comentarios-count');
  if (!lista) return;

  const todos = [];
  const idsVistos = new Set();

  try {
    const refA = collection(firestore, 'movie_comments', movieId, 'comments');
    const snapA = await getDocs(refA);
    snapA.forEach(d => {
      const data = d.data();
      if (!idsVistos.has(d.id)) {
        idsVistos.add(d.id);
        todos.push({ id: d.id, ...data });
      }
    });
    console.log('✅ Ruta A (subcolección):', snapA.size, 'comentarios');
  } catch (e) {
    console.warn('⚠️ Ruta A falló:', e.message);
  }

  try {
    const refB = query(
      collectionGroup(firestore, 'movie_comments'),
      where('movieId', '==', movieTitle)
    );
    const snapB = await getDocs(refB);
    snapB.forEach(d => {
      if (!idsVistos.has(d.id)) {
        idsVistos.add(d.id);
        todos.push({ id: d.id, ...d.data() });
      }
    });
    console.log('✅ Ruta B (collectionGroup por título):', snapB.size, 'comentarios');
  } catch (e) {
    console.warn('⚠️ Ruta B falló:', e.message);
  }

  try {
    const refC = query(
      collectionGroup(firestore, 'movie_comments'),
      where('movieId', '==', movieId)
    );
    const snapC = await getDocs(refC);
    snapC.forEach(d => {
      if (!idsVistos.has(d.id)) {
        idsVistos.add(d.id);
        todos.push({ id: d.id, ...d.data() });
      }
    });
    console.log('✅ Ruta C (collectionGroup por id):', snapC.size, 'comentarios');
  } catch (e) {
    console.warn('⚠️ Ruta C falló:', e.message);
  }

  todos.sort((a, b) => {
    const tA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp || 0);
    const tB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp || 0);
    return tB - tA;
  });

  if (count) count.textContent = todos.length;

  if (todos.length === 0) {
    lista.innerHTML = '<p style="color:#6b7280;text-align:center;padding:20px;">Sé el primero en comentar</p>';
    return;
  }

  lista.innerHTML = todos.map(c => renderComentarioFirestore(c)).join('');
}

function renderComentarioFirestore(c) {
  const fecha = c.timestamp?.toDate ? c.timestamp.toDate().toLocaleString('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : 'Ahora';
  const nombre = escapeHtml(c.username || c.userName || 'Usuario');
  const foto = c.userPhotoUrl || c.userPhoto || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg';
  const texto = escapeHtml(c.text || c.message || '');

  return `
    <div class="comentario-item">
      <img src="${foto}" class="comentario-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
      <div class="comentario-body">
        <div class="comentario-header">
          <span class="comentario-nombre">${nombre}</span>
          <span class="comentario-fecha">${fecha}</span>
        </div>
        <p class="comentario-texto">${texto}</p>
      </div>
    </div>`;
}

async function enviarComentarioFirestore(contenido) {
  const user = auth.currentUser;
  if (!user) { alert('Debes iniciar sesión'); return; }
  const input = document.getElementById('comentario-input');
  const texto = input.value.trim();
  if (!texto) return;

  const movieTitle = contenido.title || contenido.id;

  try {
    const comentarioRef = collection(firestore, 'movie_comments', contenido.id, 'comments');
    await addDoc(comentarioRef, {
      userId: user.uid,
      username: user.displayName || 'Usuario',
      userPhotoUrl: user.photoURL || '',
      text: texto,
      movieId: movieTitle,
      timestamp: serverTimestamp(),
      likes: [],
      replies: [],
      replyCount: 0,
      edited: false,
      lastEdited: null
    });

    try {
      const legacyRef = collection(firestore, 'movie_comments');
      await addDoc(legacyRef, {
        userId: user.uid,
        username: user.displayName || 'Usuario',
        userPhotoUrl: user.photoURL || '',
        text: texto,
        movieId: movieTitle,
        timestamp: serverTimestamp(),
        likes: [],
        replies: [],
        replyCount: 0,
        edited: false,
        lastEdited: null
      });
    } catch (e) {
      console.warn('⚠️ No se pudo guardar en estructura legacy:', e.message);
    }

    input.value = '';
    mostrarNotificacion('Comentario publicado', 'Tu comentario se publicó correctamente');
    await cargarComentariosFirestore(contenido);
  } catch (err) {
    console.error(err);
    alert('Error al publicar: ' + err.message);
  }
}

// ============ LISTA / FAVORITOS ============
async function estaEnLista(userId, movieId, tipo) {
  try {
    const docRef = doc(firestore, 'user_notifications', userId, tipo, movieId);
    const snap = await getDoc(docRef);
    return snap.exists();
  } catch (err) { return false; }
}

async function toggleLista(movie, tipo) {
  const user = auth.currentUser;
  if (!user) { alert('Debes iniciar sesión'); return; }
  try {
    const docRef = doc(firestore, 'user_notifications', user.uid, tipo, movie.id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await deleteDoc(docRef);
      mostrarNotificacion('Eliminado', `${movie.title} eliminado`);
    } else {
      await setDoc(docRef, {
        movieId: movie.id, title: movie.title,
        image: movie.imageUrl || movie.image || '',
        addedAt: serverTimestamp(), userId: user.uid
      });
      mostrarNotificacion('Agregado', `${movie.title} añadido`);
    }
    if (tipo === 'mi_lista') {
      const btn = document.getElementById('btn-mi-lista');
      const activo = !snap.exists();
      btn.classList.toggle('active', activo);
      btn.innerHTML = `<i class="fa-solid fa-${activo ? 'check' : 'plus'}"></i> ${activo ? 'En Mi Lista' : 'Mi Lista'}`;
    } else {
      const btn = document.getElementById('btn-favorito');
      const activo = !snap.exists();
      btn.classList.toggle('active', activo);
      btn.innerHTML = `<i class="fa-${activo ? 'solid' : 'regular'} fa-heart"></i> ${activo ? 'En Favoritos' : 'Favorito'}`;
    }
  } catch (err) { alert('Error: ' + err.message); }
}

async function mostrarMiLista() {
  const user = auth.currentUser;
  if (!user) return;
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Mi Lista</h2>
      </div>
      <div id="lista-container"><p class="empty-state">Cargando...</p></div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  try {
    const snapshot = await getDocs(collection(firestore, 'user_notifications', user.uid, 'mi_lista'));
    const items = [];
    snapshot.forEach(d => items.push({ id: d.id, ...d.data() }));
    const container = document.getElementById('lista-container');
    if (items.length === 0) { container.innerHTML = '<p class="empty-state">No tienes películas en tu lista</p>'; return; }
    container.innerHTML = `<div class="grid-completo">${items.map(item => {
      const movie = PELICULAS.find(m => m.id === item.movieId);
      if (movie) return renderCardPelicula(movie);
      return `<div class="pelicula-card" data-id="${item.movieId}"><div class="pelicula-poster"><img src="${item.image || 'https://via.placeholder.com/300x450'}"></div><div class="pelicula-info"><h4>${item.title}</h4></div></div>`;
    }).join('')}</div>`;
    bindPeliculaCards();
  } catch (err) {
    document.getElementById('lista-container').innerHTML = '<p class="empty-state">Error: ' + err.message + '</p>';
  }
}

async function mostrarFavoritos() {
  const user = auth.currentUser;
  if (!user) return;
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Favoritos</h2>
      </div>
      <div id="fav-container"><p class="empty-state">Cargando...</p></div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  try {
    const snapshot = await getDocs(collection(firestore, 'user_notifications', user.uid, 'favoritos'));
    const items = [];
    snapshot.forEach(d => items.push({ id: d.id, ...d.data() }));
    const container = document.getElementById('fav-container');
    if (items.length === 0) { container.innerHTML = '<p class="empty-state">No tienes favoritos aún</p>'; return; }
    container.innerHTML = `<div class="grid-completo">${items.map(item => {
      const movie = PELICULAS.find(m => m.id === item.movieId);
      if (movie) return renderCardPelicula(movie);
      return `<div class="pelicula-card" data-id="${item.movieId}"><div class="pelicula-poster"><img src="${item.image || 'https://via.placeholder.com/300x450'}"></div><div class="pelicula-info"><h4>${item.title}</h4></div></div>`;
    }).join('')}</div>`;
    bindPeliculaCards();
  } catch (err) {
    document.getElementById('fav-container').innerHTML = '<p class="empty-state">Error: ' + err.message + '</p>';
  }
}

// ============ SERIES ============
function mostrarSeries() {
  VISTA_ACTUAL = { tipo: 'series' };
  detenerHeroSlider();
  let html = '<h2 class="seccion-titulo" style="color:#fff;font-size:28px;font-weight:800;margin-bottom:25px;">Series</h2>';
  if (SERIES.length === 0) {
    html += '<p class="empty-state">No hay series disponibles</p>';
  } else {
    html += `<div class="grid-completo">${SERIES.map(s => {
      const img = s.imageUrl || s.image || 'https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen';
      return `<div class="pelicula-card" data-serie-id="${s.id}">
        <div class="pelicula-poster"><img src="${img}" onerror="this.src='https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen'">
          <div class="pelicula-overlay"><div class="pelicula-overlay-play"><i class="fa-solid fa-play"></i></div></div>
        </div>
        <div class="pelicula-info"><h4>${s.title || 'Sin título'}</h4></div>
      </div>`;
    }).join('')}</div>`;
  }
  dynamicContent.innerHTML = html;
  document.querySelectorAll('[data-serie-id]').forEach(card => {
    card.addEventListener('click', () => {
      const serie = SERIES.find(s => s.id === card.dataset.serieId);
      if (serie) mostrarDetalleSerie(serie);
    });
  });
}

async function mostrarDetalleSerie(serie) {
  VISTA_ACTUAL = { tipo: 'serie', serie };
  detenerHeroSlider();
  const img = serie.imageUrl || serie.image || 'https://via.placeholder.com/300x450/1a0b2e/a78bfa?text=Sin+Imagen';
  const bg = serie.backgroundImageUrl || img;
  const titulo = serie.title || 'Sin título';
  const year = serie.year || '—';
  const rating = serie.rating ? serie.rating.toFixed(1) : '—';
  const descripcion = serie.description || 'Sin descripción disponible.';
  let temporadas = [];
  if (serie.seasons && typeof serie.seasons === 'object') {
    temporadas = Object.values(serie.seasons).sort((a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0));
  }
  let temporadasHtml = '';
  if (temporadas.length > 0) {
    temporadasHtml = '<div class="series-temporadas">';
    temporadas.forEach((temp, idx) => {
      const episodios = temp.episodes ? Object.values(temp.episodes).sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0)) : [];
      temporadasHtml += `
        <div class="temporada-card ${idx === 0 ? 'abierta' : ''}">
          <div class="temporada-header">
            <h3><i class="fa-solid fa-layer-group"></i> ${temp.name || 'Temporada ' + (temp.seasonNumber || idx + 1)} <span class="ep-count">${episodios.length} episodios</span></h3>
            <i class="fa-solid fa-chevron-down"></i>
          </div>
          <div class="temporada-episodios">
            ${episodios.map(ep => `
              <div class="episodio-item" data-ep-url="${ep.videoUrl || ''}" data-ep-title="${(ep.title || '').replace(/"/g,'&quot;')}">
                <div class="episodio-numero">${ep.episodeNumber || '?'}</div>
                <div class="episodio-info"><h4>${ep.title || 'Episodio ' + (ep.episodeNumber || '')}</h4><p>${ep.description ? ep.description.substring(0, 90) + '...' : ''}</p></div>
                <div class="episodio-play"><i class="fa-solid fa-play"></i></div>
              </div>`).join('')}
          </div>
        </div>`;
    });
    temporadasHtml += '</div>';
  } else {
    temporadasHtml = '<p class="empty-state" style="padding:40px;">Esta serie aún no tiene episodios</p>';
  }

  const user = auth.currentUser;
  const enLista = user ? await estaEnLista(user.uid, serie.id, 'mi_lista') : false;
  const enFavoritos = user ? await estaEnLista(user.uid, serie.id, 'favoritos') : false;

  dynamicContent.innerHTML = `
    <div class="detalle-container">
      <div class="detalle-hero" style="background-image:url('${bg}')">
        <div class="detalle-hero-content">
          <img src="${img}" alt="${titulo}" class="detalle-poster" onerror="this.src='https://via.placeholder.com/220x330/1a0b2e/a78bfa?text=Sin+Imagen'">
          <div class="detalle-hero-info">
            <h1 class="detalle-titulo">${titulo}</h1>
            <div class="detalle-meta">
              <span class="badge-cat">Serie</span>
              <span><i class="fa-solid fa-calendar"></i> ${year}</span>
              <span class="badge-rating"><i class="fa-solid fa-star"></i> ${rating}</span>
            </div>
            <div class="detalle-botones">
              <button class="btn-lista ${enLista ? 'active' : ''}" id="btn-mi-lista"><i class="fa-solid fa-${enLista ? 'check' : 'plus'}"></i> ${enLista ? 'En Mi Lista' : 'Mi Lista'}</button>
              <button class="btn-favorito ${enFavoritos ? 'active' : ''}" id="btn-favorito"><i class="fa-${enFavoritos ? 'solid' : 'regular'} fa-heart"></i> ${enFavoritos ? 'En Favoritos' : 'Favorito'}</button>
              <button class="btn-secundario" id="btn-volver-serie"><i class="fa-solid fa-arrow-left"></i> Volver</button>
            </div>
          </div>
        </div>
      </div>

      <div class="detalle-body"><div class="detalle-seccion"><h3>Sinopsis</h3><p>${descripcion}</p></div></div>
      <div class="detalle-body">
        <h3 style="color:#a78bfa;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:15px;">
          <i class="fa-solid fa-list"></i> Temporadas y Episodios
        </h3>
        ${temporadasHtml}
      </div>
      <div class="detalle-body">
        <div class="detalle-seccion comentarios-seccion">
          <h3><i class="fa-solid fa-comments"></i> Comentarios (<span id="comentarios-count">0</span>)</h3>
          <div class="comentario-form">
            <img id="comentario-avatar" src="${user?.photoURL || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'}" class="comentario-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
            <div class="comentario-input-wrapper">
              <input type="text" id="comentario-input" placeholder="Escribe un comentario..." maxlength="300">
              <button id="btn-enviar-comentario"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
          </div>
          <div id="comentarios-lista" class="comentarios-lista"><p style="color:#6b7280;text-align:center;padding:20px;">Cargando comentarios...</p></div>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-volver-serie').addEventListener('click', mostrarSeries);
  document.getElementById('btn-mi-lista').addEventListener('click', () => toggleLista(serie, 'mi_lista'));
  document.getElementById('btn-favorito').addEventListener('click', () => toggleLista(serie, 'favoritos'));
  document.getElementById('btn-enviar-comentario').addEventListener('click', () => enviarComentarioFirestore(serie));
  document.getElementById('comentario-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') enviarComentarioFirestore(serie); });
  document.querySelectorAll('.temporada-header').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('abierta')));
  document.querySelectorAll('.episodio-item').forEach(ep => {
    ep.addEventListener('click', () => {
      const url = ep.dataset.epUrl;
      const title = ep.dataset.epTitle;
      if (url) abrirReproductor(url, titulo + ' - ' + title, false);
      else alert('Este episodio no tiene video');
    });
  });
  await cargarComentariosFirestore(serie);
}

// ============ BUSCADOR ============
const buscadorOverlay = document.getElementById('buscador-overlay');
const inputBusqueda = document.getElementById('input-busqueda');
const resultadosBusqueda = document.getElementById('resultados-busqueda');

document.getElementById('top-buscar').addEventListener('click', () => {
  buscadorOverlay.classList.remove('hidden');
  inputBusqueda.focus();
});
document.getElementById('cerrar-buscador').addEventListener('click', () => {
  buscadorOverlay.classList.add('hidden');
  inputBusqueda.value = '';
  resultadosBusqueda.innerHTML = '';
});
inputBusqueda.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (q.length < 2) { resultadosBusqueda.innerHTML = ''; return; }
  buscar(q);
});

function buscar(query) {
  const pelis = PELICULAS.filter(m => (m.title || '').toLowerCase().includes(query) || (m.description || '').toLowerCase().includes(query)).slice(0, 30);
  const series = SERIES.filter(s => (s.title || '').toLowerCase().includes(query)).slice(0, 30);
  let html = '';
  if (pelis.length > 0) {
    html += `<div class="resultados-header">Películas (${pelis.length})</div>`;
    html += `<div class="grid-completo" style="margin-bottom:30px;">${pelis.map(m => renderCardPelicula(m)).join('')}</div>`;
  }
  if (series.length > 0) {
    html += `<div class="resultados-header">Series (${series.length})</div>`;
    html += `<div class="grid-completo">${series.map(s => {
      const img = s.imageUrl || s.image || 'https://via.placeholder.com/300x450';
      return `<div class="pelicula-card" data-serie-id="${s.id}"><div class="pelicula-poster"><img src="${img}"></div><div class="pelicula-info"><h4>${s.title}</h4></div></div>`;
    }).join('')}</div>`;
  }
  if (!html) html = '<p class="empty-state">No se encontraron resultados para: <strong>' + query + '</strong></p>';
  resultadosBusqueda.innerHTML = html;
  resultadosBusqueda.querySelectorAll('.pelicula-card').forEach(card => {
    card.addEventListener('click', () => {
      buscadorOverlay.classList.add('hidden');
      inputBusqueda.value = '';
      resultadosBusqueda.innerHTML = '';
      if (card.dataset.serieId) {
        const s = SERIES.find(x => x.id === card.dataset.serieId);
        if (s) mostrarDetalleSerie(s);
      } else if (card.dataset.id) {
        const m = PELICULAS.find(x => x.id === card.dataset.id);
        if (m) mostrarDetallePelicula(m);
      }
    });
  });
}

// ============ MENÚ CUENTA ============
const cuentaOverlay = document.getElementById('cuenta-overlay');
document.getElementById('top-cuenta').addEventListener('click', () => cuentaOverlay.classList.remove('hidden'));
document.getElementById('cerrar-cuenta').addEventListener('click', () => cuentaOverlay.classList.add('hidden'));
cuentaOverlay.addEventListener('click', (e) => { if (e.target === cuentaOverlay) cuentaOverlay.classList.add('hidden'); });

document.getElementById('op-mi-cuenta').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarMiCuenta(); });
document.getElementById('op-amigos').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarAmigos(); });
document.getElementById('op-mi-lista').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarMiLista(); });
document.getElementById('op-favoritos').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarFavoritos(); });
document.getElementById('op-nuestras-apps').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarNuestrasApps(); });
document.getElementById('op-configuracion').addEventListener('click', () => { cuentaOverlay.classList.add('hidden'); mostrarConfiguracion(); });
document.getElementById('op-salir').addEventListener('click', async () => { cuentaOverlay.classList.add('hidden'); await cerrarSesion(); });

// ============ NUESTRAS APPS ============
async function mostrarNuestrasApps() {
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo"><i class="fa-solid fa-mobile-screen-button" style="color:#a78bfa;"></i> Nuestras Apps</h2>
      </div>
      <div id="apps-container"><p class="empty-state">Cargando apps...</p></div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  try {
    const appsRef = ref(db, 'app_config/apps');
    const snapshot = await get(appsRef);
    const container = document.getElementById('apps-container');
    if (!snapshot.exists()) {
      container.innerHTML = '<p class="empty-state">No hay apps disponibles por ahora</p>';
      return;
    }
    const appsData = snapshot.val();
    const apps = [];
    for (const key in appsData) {
      if (appsData[key] && appsData[key].isActive !== false) {
        apps.push({ id: key, ...appsData[key] });
      }
    }
    apps.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    if (apps.length === 0) {
      container.innerHTML = '<p class="empty-state">No hay apps disponibles</p>';
      return;
    }
    container.innerHTML = `<div class="grid-completo">${apps.map(app => `
      <div class="producto-card" data-url="${app.downloadUrl || ''}">
        <img class="producto-img" src="${app.iconUrl || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'}" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'" style="object-fit:contain;padding:20px;background:#0a0a0a;">
        <div class="producto-info">
          <h4>${app.name || 'App'}</h4>
          <p style="color:#9ca3af;font-size:12px;">${app.description || ''}</p>
        </div>
      </div>`).join('')}</div>`;
    container.querySelectorAll('.producto-card').forEach(card => {
      card.addEventListener('click', () => { if (card.dataset.url) ipcRenderer.invoke('abrir-navegador', card.dataset.url); });
    });
  } catch (err) {
    document.getElementById('apps-container').innerHTML = '<p class="empty-state">Error: ' + err.message + '</p>';
  }
}

// ============ MI CUENTA ============
function mostrarMiCuenta() {
  const user = auth.currentUser;
  if (!user) return;
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Mi Cuenta</h2>
      </div>
      <div style="max-width:600px;margin:0 auto;">
        <div style="text-align:center;padding:30px;background:#141414;border-radius:20px;border:1px solid #2a1a3d;margin-bottom:20px;">
          <img src="${user.photoURL || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'}" style="width:120px;height:120px;border-radius:50%;border:4px solid #7c3aed;object-fit:cover;margin-bottom:15px;">
          <h2 style="color:#fff;font-size:24px;margin-bottom:5px;">${user.displayName || 'Usuario'}</h2>
          <p style="color:#9ca3af;font-size:14px;">${user.email}</p>
        </div>
        <div class="config-item"><div class="config-item-info"><h4>Nombre</h4><p>${user.displayName || 'Sin nombre'}</p></div></div>
        <div class="config-item"><div class="config-item-info"><h4>Correo</h4><p>${user.email}</p></div></div>
        <div style="margin-top:30px;text-align:center;">
          <button class="btn-peligro" id="btn-eliminar-cuenta"><i class="fa-solid fa-trash"></i> Eliminar cuenta permanentemente</button>
        </div>
      </div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  document.getElementById('btn-eliminar-cuenta').addEventListener('click', confirmarEliminarCuenta);
}

function confirmarEliminarCuenta() {
  const confirmar = prompt('⚠️ Esta acción eliminará PERMANENTEMENTE tu cuenta.\n\nEscribe "ELIMINAR" para confirmar:');
  if (confirmar !== 'ELIMINAR') { if (confirmar !== null) alert('Cancelado'); return; }
  const user = auth.currentUser;
  if (!user) return;
  Promise.all([set(ref(db, 'users/' + user.uid), null), set(ref(db, 'friends/' + user.uid), null)])
    .then(() => user.delete())
    .then(() => alert('✅ Cuenta eliminada'))
    .catch(err => alert(err.code === 'auth/requires-recent-login' ? 'Cierra sesión y vuelve a entrar' : 'Error: ' + err.message));
}

// ============ AMIGOS ============
async function mostrarAmigos() {
  const user = auth.currentUser;
  if (!user) return;
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Mis Amigos</h2>
        <button class="btn-secundario" id="btn-buscar-amigos" style="margin-left:auto;background:linear-gradient(135deg,#7c3aed,#4c1d95);color:#fff;border:none;padding:12px 20px;border-radius:10px;font-weight:600;cursor:pointer;">
          <i class="fa-solid fa-user-plus"></i> Agregar amigo
        </button>
      </div>
      <div id="amigos-lista" class="amigos-lista"><p style="color:#9ca3af;text-align:center;padding:40px;">Cargando amigos...</p></div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  document.getElementById('btn-buscar-amigos').addEventListener('click', buscarAmigos);
  try {
    const snapshot = await get(ref(db, 'friends/' + user.uid));
    const amigosIds = [];
    if (snapshot.exists()) {
      const data = snapshot.val();
      for (const k in data) if (data[k] === true || data[k] === 'true') amigosIds.push(k);
    }
    const lista = document.getElementById('amigos-lista');
    if (amigosIds.length === 0) {
      lista.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:60px;">Aún no tienes amigos. Usa "Agregar amigo".</p>';
      return;
    }
    const amigos = [];
    for (const id of amigosIds) {
      const uSnap = await get(ref(db, 'users/' + id));
      if (uSnap.exists()) amigos.push({ id, ...uSnap.val() });
    }
    lista.innerHTML = amigos.map(a => {
      const foto = a.photoBase64 && a.photoBase64.startsWith('http') ? a.photoBase64 : 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg';
      return `<div class="amigo-item">
        <img src="${foto}" class="amigo-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
        <div class="amigo-info">
          <h4>${a.username || 'Usuario'}</h4>
          <p>${a.online ? '<span class="amigo-online"></span> En línea' : '<span class="amigo-offline"></span> Desconectado'}</p>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    document.getElementById('amigos-lista').innerHTML = '<p style="color:#ef4444;text-align:center;padding:40px;">Error</p>';
  }
}

async function buscarAmigos() {
  const user = auth.currentUser;
  if (!user) return;
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Buscar Amigos</h2>
      </div>
      <div style="max-width:600px;margin:0 auto 20px;">
        <div style="position:relative;">
          <i class="fa-solid fa-magnifying-glass" style="position:absolute;left:15px;top:50%;transform:translateY(-50%);color:#7c3aed;"></i>
          <input type="text" id="input-buscar-amigo" placeholder="Buscar por nombre de usuario..." style="width:100%;padding:15px 15px 15px 45px;background:#141414;border:2px solid #2a1a3d;border-radius:12px;color:#fff;font-size:15px;outline:none;">
        </div>
      </div>
      <div id="resultados-amigos" class="amigos-lista"><p style="color:#9ca3af;text-align:center;padding:40px;">Escribe un nombre para buscar</p></div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarAmigos);
  document.getElementById('input-buscar-amigo').focus();
  document.getElementById('input-buscar-amigo').addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) {
      document.getElementById('resultados-amigos').innerHTML = '<p style="color:#9ca3af;text-align:center;padding:40px;">Escribe al menos 2 caracteres</p>';
      return;
    }
    await buscarUsuarios(q);
  });
}

async function buscarUsuarios(query) {
  const user = auth.currentUser;
  if (!user) return;
  const container = document.getElementById('resultados-amigos');
  container.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:40px;">Buscando...</p>';
  try {
    const usersRef = ref(db, 'users');
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) { container.innerHTML = '<p class="empty-state">No hay usuarios</p>'; return; }
    const friendsSnap = await get(ref(db, 'friends/' + user.uid));
    const amigosIds = [];
    if (friendsSnap.exists()) {
      const d = friendsSnap.val();
      for (const k in d) if (d[k] === true || d[k] === 'true') amigosIds.push(k);
    }
    const users = snapshot.val();
    const resultados = [];
    for (const uid in users) {
      if (uid === user.uid) continue;
      const u = users[uid];
      const nombre = (u.username || '').toLowerCase();
      if (nombre.includes(query)) resultados.push({ id: uid, ...u });
    }
    if (resultados.length === 0) { container.innerHTML = '<p class="empty-state">No se encontraron usuarios</p>'; return; }
    container.innerHTML = resultados.map(u => {
      const foto = u.photoBase64 && u.photoBase64.startsWith('http') ? u.photoBase64 : 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg';
      const esAmigo = amigosIds.includes(u.id);
      return `<div class="amigo-item">
        <img src="${foto}" class="amigo-avatar" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
        <div class="amigo-info">
          <h4>${u.username || 'Usuario'}</h4>
          <p>${u.online ? '<span class="amigo-online"></span> En línea' : '<span class="amigo-offline"></span> Desconectado'}</p>
        </div>
        ${esAmigo ? '<span style="color:#10b981;font-weight:600;font-size:13px;"><i class="fa-solid fa-check"></i> Amigos</span>' :
          `<button class="btn-enviar-solicitud" data-uid="${u.id}" data-nombre="${u.username || 'Usuario'}" style="background:linear-gradient(135deg,#7c3aed,#4c1d95);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;">
            <i class="fa-solid fa-user-plus"></i> Agregar
          </button>`}
      </div>`;
    }).join('');
    container.querySelectorAll('.btn-enviar-solicitud').forEach(btn => {
      btn.addEventListener('click', () => enviarSolicitudAmistad(btn.dataset.uid, btn.dataset.nombre, btn));
    });
  } catch (err) {
    container.innerHTML = '<p class="empty-state">Error: ' + err.message + '</p>';
  }
}

async function enviarSolicitudAmistad(toUserId, toUserName, btnElement) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const requestId = push(ref(db, 'friend_requests')).key;
    await set(ref(db, 'friend_requests/' + requestId), {
      requestId, fromUserId: user.uid,
      fromUserName: user.displayName || 'Usuario',
      fromUserPhoto: user.photoURL || '',
      toUserId, toUserName, status: 'pending', timestamp: Date.now()
    });
    btnElement.outerHTML = '<span style="color:#fbbf24;font-weight:600;font-size:13px;"><i class="fa-solid fa-clock"></i> Enviada</span>';
    mostrarNotificacion('Solicitud enviada', `Enviaste solicitud a ${toUserName}`);
  } catch (err) { alert('Error: ' + err.message); }
}

// ============ CONFIGURACIÓN ============
function mostrarConfiguracion() {
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <button class="btn-volver" id="btn-volver"><i class="fa-solid fa-arrow-left"></i> Volver</button>
        <h2 class="vista-completa-titulo">Configuración</h2>
      </div>
      <div class="config-seccion">
        <div class="config-item">
          <div class="config-item-info"><h4>Reproducción automática</h4><p>Reproducir videos automáticamente</p></div>
          <button class="config-toggle ${CONFIG_USUARIO.autoplay ? 'active' : ''}" data-config="autoplay"></button>
        </div>
        <div class="config-item">
          <div class="config-item-info"><h4>Notificaciones</h4><p>Recibir notificaciones</p></div>
          <button class="config-toggle ${CONFIG_USUARIO.notificaciones ? 'active' : ''}" data-config="notificaciones"></button>
        </div>
      </div>
    </div>`;
  document.getElementById('btn-volver').addEventListener('click', mostrarHome);
  document.querySelectorAll('.config-toggle').forEach(t => {
    t.addEventListener('click', () => {
      const key = t.dataset.config;
      CONFIG_USUARIO[key] = !CONFIG_USUARIO[key];
      t.classList.toggle('active', CONFIG_USUARIO[key]);
      guardarConfig();
    });
  });
}

// ============ TIENDA ============
async function mostrarTienda() {
  dynamicContent.innerHTML = `
    <div class="vista-completa">
      <div class="vista-completa-header">
        <h2 class="vista-completa-titulo"><i class="fa-solid fa-store" style="color:#a78bfa;"></i> Tienda</h2>
      </div>
      <div id="tienda-container"><p class="empty-state">Cargando productos...</p></div>
    </div>`;
  try {
    const q = query(collection(firestore, 'hotmart_products'), where('active', '==', true), orderBy('order', 'asc'));
    const snapshot = await getDocs(q);
    const productos = [];
    snapshot.forEach(doc => productos.push({ id: doc.id, ...doc.data() }));
    const container = document.getElementById('tienda-container');
    if (productos.length === 0) { container.innerHTML = '<p class="empty-state">No hay productos</p>'; return; }
    container.innerHTML = `<div class="tienda-grid">${productos.map(p => `
      <div class="producto-card" data-url="${p.affiliateUrl || ''}">
        <img class="producto-img" src="${p.customImage || p.imageUrl || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'}" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
        <div class="producto-info">
          <h4>${p.customTitle || p.title || 'Producto'}</h4>
          <div class="producto-precio">${p.price || 'Ver precio'}</div>
          <div class="producto-productor">${p.producerName || 'Hotmart'}</div>
        </div>
      </div>`).join('')}</div>`;
    container.querySelectorAll('.producto-card').forEach(card => {
      card.addEventListener('click', () => { if (card.dataset.url) ipcRenderer.invoke('abrir-navegador', card.dataset.url); });
    });
  } catch (err) {
    document.getElementById('tienda-container').innerHTML = '<p class="empty-state">Error: ' + err.message + '</p>';
  }
}
document.getElementById('top-tienda').addEventListener('click', mostrarTienda);

// ============================================================
// REPRODUCTOR AVANZADO - VOD + HLS + WEBVIEW
// ============================================================

const playerOverlay = document.getElementById('player-overlay');
const videoPlayer = document.getElementById('video-player');
const hlsPlayer = document.getElementById('hls-player');
const webviewPlayer = document.getElementById('webview-player');
const playerControls = document.getElementById('player-controls');
const playerTitle = document.getElementById('player-title');
const playerSeek = document.getElementById('player-seek');
const playerCurrent = document.getElementById('player-current');
const playerTotal = document.getElementById('player-total');
const playerPlay = document.getElementById('player-play');
const playerVolume = document.getElementById('player-volume');
const playerSpeed = document.getElementById('player-speed');
const playerQuality = document.getElementById('player-quality');
const playerCenter = document.getElementById('player-center');
const playerBottom = document.getElementById('player-bottom');
const playerProgressContainer = document.getElementById('player-progress-container');
const liveBadge = document.getElementById('live-badge');

let ocultarTimer = null;
let hlsInstance = null;
let reproductorActivo = 'video';
let esContenidoVivo = false;

// Mini reproductor
const miniPlayer = document.getElementById('mini-player');
const miniVideo = document.getElementById('mini-video');
const miniTitle = document.getElementById('mini-title');
const miniPlayBtn = document.getElementById('mini-play');
let miniHlsInstance = null;
let urlActualMini = null;
let tituloActualMini = null;
let tipoActualMini = null;

function esUrlEmbed(url) {
  if (!url) return true;
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('.php') ||
      lowerUrl.includes('.html') ||
      lowerUrl.includes('.htm') ||
      lowerUrl.includes('/embed/') ||
      lowerUrl.includes('youtube.com/embed/') ||
      lowerUrl.includes('youtu.be/') ||
      lowerUrl.includes('vimeo.com/') ||
      lowerUrl.includes('dailymotion.com/') ||
      lowerUrl.includes('streamtape.com') ||
      lowerUrl.includes('/tv/') ||
      lowerUrl.includes('vivo') ||
      lowerUrl.includes('canal')) {
    return true;
  }
  if (lowerUrl.match(/\.(m3u8|mp4|mkv|ts|avi|mov|webm)(\?.*)?$/)) {
    return false;
  }
  return true;
}

function esUrlHLS(url) {
  if (!url) return false;
  return url.toLowerCase().includes('.m3u8');
}

function abrirReproductor(url, titulo, esVivo = false) {
  if (!url) { alert('URL no disponible'); return; }
  esContenidoVivo = esVivo;
  playerOverlay.classList.remove('hidden');
  playerTitle.textContent = titulo || 'Reproduciendo';
  limpiarReproductores();

  playerControls.classList.add('visible');
  playerCenter.style.display = 'flex';
  playerBottom.style.display = 'block';

  if (esVivo) {
    liveBadge.style.display = 'block';
    playerProgressContainer.style.display = 'none';
    document.getElementById('player-rewind').style.display = 'none';
    document.getElementById('player-forward').style.display = 'none';
  } else {
    liveBadge.style.display = 'none';
    playerProgressContainer.style.display = 'flex';
    document.getElementById('player-rewind').style.display = 'flex';
    document.getElementById('player-forward').style.display = 'flex';
  }

  if (esUrlEmbed(url)) {
    reproducirWebView(url);
  } else if (esUrlHLS(url)) {
    reproducirHLS(url);
  } else {
    reproducirVideo(url);
  }

  mostrarControles();
  setTimeout(() => {
    if (!document.fullscreenElement) {
      playerOverlay.requestFullscreen().catch(e => console.log('Fullscreen:', e));
    }
  }, 300);
}

function reproducirVideo(url) {
  reproductorActivo = 'video';
  videoPlayer.style.display = 'block';
  hlsPlayer.style.display = 'none';
  webviewPlayer.style.display = 'none';
  playerCenter.style.display = 'flex';
  playerBottom.style.display = 'block';
  playerQuality.style.display = 'none';

  videoPlayer.style.width = '100%';
  videoPlayer.style.height = '100%';
  videoPlayer.style.objectFit = 'contain';

  videoPlayer.src = url;
  videoPlayer.volume = parseFloat(playerVolume.value);
  if (CONFIG_USUARIO.autoplay) videoPlayer.play().catch(e => console.log(e));
}

function reproducirHLS(url) {
  reproductorActivo = 'hls';
  videoPlayer.style.display = 'none';
  hlsPlayer.style.display = 'block';
  webviewPlayer.style.display = 'none';
  playerCenter.style.display = 'flex';
  playerBottom.style.display = 'block';
  playerQuality.style.display = 'block';

  hlsPlayer.style.width = '100%';
  hlsPlayer.style.height = '100%';
  hlsPlayer.style.objectFit = 'contain';
  hlsPlayer.volume = parseFloat(playerVolume.value);
  hlsPlayer.controls = false;

  if (Hls.isSupported()) {
    if (hlsInstance) hlsInstance.destroy();

    playerQuality.innerHTML = '<option value="-1" selected>Auto</option>';

    hlsInstance = new Hls({ 
      enableWorker: true, 
      lowLatencyMode: true,
      startLevel: -1
    });

    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(hlsPlayer);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('✅ HLS manifest parsed. Niveles:', hlsInstance.levels.length);
      poblarSelectCalidad(hlsInstance);
      if (CONFIG_USUARIO.autoplay) hlsPlayer.play().catch(e => console.log(e));
    });

    hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      if (hlsInstance.autoLevelEnabled) {
        playerQuality.value = '-1';
      }
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hlsInstance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hlsInstance.recoverMediaError();
            break;
          default:
            reproducirWebView(url);
            break;
        }
      }
    });
  } else if (hlsPlayer.canPlayType('application/vnd.apple.mpegurl')) {
    hlsPlayer.src = url;
    if (CONFIG_USUARIO.autoplay) hlsPlayer.play().catch(e => console.log(e));
  }
}

function poblarSelectCalidad(hls) {
  const niveles = hls.levels || [];
  if (niveles.length === 0) {
    playerQuality.style.display = 'none';
    return;
  }
  playerQuality.style.display = 'block';

  const nivelesOrdenados = niveles
    .map((nivel, index) => ({ index, height: nivel.height || 0, bitrate: nivel.bitrate || 0 }))
    .sort((a, b) => b.height - a.height);

  let opciones = '<option value="-1" selected>Auto</option>';
  nivelesOrdenados.forEach(n => {
    const label = n.height ? `${n.height}p` : `${Math.round(n.bitrate / 1000)}kbps`;
    opciones += `<option value="${n.index}">${label}</option>`;
  });
  playerQuality.innerHTML = opciones;

  const calGuardada = CONFIG_USUARIO.calidad;
  if (calGuardada && calGuardada !== 'auto') {
    const objetivo = parseInt(calGuardada, 10);
    const match = nivelesOrdenados.find(n => n.height === objetivo);
    if (match) {
      playerQuality.value = String(match.index);
      hls.currentLevel = match.index;
    } else {
      playerQuality.value = '-1';
    }
  } else {
    playerQuality.value = '-1';
    hls.currentLevel = -1;
  }
}

function reproducirWebView(url) {
  reproductorActivo = 'webview';
  videoPlayer.style.display = 'none';
  hlsPlayer.style.display = 'none';
  webviewPlayer.style.display = 'block';
  playerQuality.style.display = 'none';

  webviewPlayer.style.width = '100vw';
  webviewPlayer.style.height = '100vh';
  webviewPlayer.style.position = 'fixed';
  webviewPlayer.style.top = '0';
  webviewPlayer.style.left = '0';
  webviewPlayer.style.zIndex = '1';
  webviewPlayer.style.border = 'none';

  playerControls.classList.add('visible');
  playerCenter.style.display = 'flex';
  playerBottom.style.display = 'block';
  playerProgressContainer.style.display = esContenidoVivo ? 'none' : 'flex';

  const inyectarScript = () => {
    try {
      webviewPlayer.executeJavaScript(`
        (function() {
          console.log('🎬 Rayito TV: Aplicando pantalla completa');
          const style = document.createElement('style');
          style.id = 'rayito-fullscreen-style';
          style.textContent = \`
            * { margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
            html, body {
              width: 100vw !important; height: 100vh !important;
              max-width: 100vw !important; max-height: 100vh !important;
              overflow: hidden !important; background: #000 !important;
              position: fixed !important; top: 0 !important; left: 0 !important;
            }
            video, iframe, embed, object,
            .video-player, .player, .jwplayer, .video-js,
            #player, #video, .plyr, .flowplayer,
            [class*="player"], [id*="player"],
            [class*="video"], [id*="video"] {
              width: 100vw !important; height: 100vh !important;
              max-width: 100vw !important; max-height: 100vh !important;
              position: fixed !important; top: 0 !important; left: 0 !important;
              right: 0 !important; bottom: 0 !important;
              z-index: 9999 !important; object-fit: contain !important;
            }
            [class*="ad-"], [class*="ads-"], [id*="ad-"], [id*="ads-"],
            [class*="advertisement"], [class*="popup"], [class*="banner"],
            [class*="sponsor"], [class*="promo"], [class*="overlay-ad"],
            .jw-overlays, .vjs-control-bar, [class*="google-ad"],
            [class*="adsterra"], [class*="popads"], [class*="propeller"],
            [class*="exoclick"], [class*="juicyads"], [class*="trafficjunky"] {
              display: none !important; visibility: hidden !important;
              pointer-events: none !important; opacity: 0 !important;
              width: 0 !important; height: 0 !important;
            }
          \`;
          document.head.appendChild(style);
          window.open = function() { return null; };
          window.alert = function() {};
          window.confirm = function() { return true; };
          const eliminarAnuncios = () => {
            document.querySelectorAll('iframe, script, ins, div').forEach(el => {
              const src = (el.src || '').toLowerCase();
              const id = (el.id || '').toLowerCase();
              const cls = (el.className || '').toString().toLowerCase();
              if (src.includes('ads') || src.includes('doubleclick') ||
                  src.includes('popads') || src.includes('propellerads') ||
                  src.includes('adsterra') || src.includes('exoclick') ||
                  id.includes('ad-') || id.includes('ads-') ||
                  cls.includes('ad-') || cls.includes('ads-') ||
                  cls.includes('advertisement') || cls.includes('sponsor')) {
                el.remove();
              }
            });
          };
          const observer = new MutationObserver(eliminarAnuncios);
          observer.observe(document.documentElement, { childList: true, subtree: true });
          eliminarAnuncios();
          setInterval(eliminarAnuncios, 2000);
          const activarAudio = () => {
            document.querySelectorAll('video, audio').forEach(el => {
              el.muted = false; el.volume = 1.0;
              el.autoplay = true; el.removeAttribute('muted');
              el.setAttribute('playsinline', '');
              const p = el.play();
              if (p !== undefined) p.catch(() => {});
            });
          };
          activarAudio();
          setTimeout(activarAudio, 500);
          setTimeout(activarAudio, 1500);
          setTimeout(activarAudio, 3000);
          setTimeout(activarAudio, 5000);
        })();
      `).catch(e => console.log('Error inyectando script:', e));
    } catch (e) { console.log('Error en inyección:', e); }
  };

  webviewPlayer.removeEventListener('dom-ready', inyectarScript);
  webviewPlayer.removeEventListener('did-finish-load', inyectarScript);
  webviewPlayer.removeEventListener('did-navigate-in-page', inyectarScript);
  webviewPlayer.addEventListener('dom-ready', inyectarScript);
  webviewPlayer.addEventListener('did-finish-load', inyectarScript);
  webviewPlayer.addEventListener('did-navigate-in-page', inyectarScript);

  webviewPlayer.src = url;
}

function limpiarReproductores() {
  try { videoPlayer.pause(); videoPlayer.src = ''; } catch (e) {}
  try { hlsPlayer.pause(); hlsPlayer.src = ''; } catch (e) {}
  if (hlsInstance) { try { hlsInstance.destroy(); hlsInstance = null; } catch (e) {} }
  try { webviewPlayer.src = 'about:blank'; } catch (e) {}
}

function cerrarReproductor() {
  limpiarReproductores();
  playerOverlay.classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

document.getElementById('player-back').addEventListener('click', cerrarReproductor);

function mostrarControles() {
  playerControls.classList.add('visible');
  clearTimeout(ocultarTimer);
  ocultarTimer = setTimeout(() => {
    if (reproductorActivo === 'webview') {
      playerControls.classList.remove('visible');
      const backBtn = document.getElementById('player-back');
      if (backBtn) {
        backBtn.style.opacity = '0.3';
        backBtn.style.transition = 'opacity 0.3s';
        backBtn.onmouseenter = () => backBtn.style.opacity = '1';
        backBtn.onmouseleave = () => backBtn.style.opacity = '0.3';
      }
    } else {
      const actual = reproductorActivo === 'hls' ? hlsPlayer : videoPlayer;
      if (actual && !actual.paused) playerControls.classList.remove('visible');
    }
  }, 5000);
}
playerOverlay.addEventListener('mousemove', mostrarControles);

playerPlay.addEventListener('click', () => {
  const actual = reproductorActivo === 'hls' ? hlsPlayer : videoPlayer;
  if (!actual) return;
  if (actual.paused) actual.play(); else actual.pause();
});

document.getElementById('player-rewind').addEventListener('click', () => {
  const actual = reproductorActivo === 'hls' ? hlsPlayer : videoPlayer;
  if (!actual) return;
  actual.currentTime = Math.max(0, actual.currentTime - 10);
});

document.getElementById('player-forward').addEventListener('click', () => {
  const actual = reproductorActivo === 'hls' ? hlsPlayer : videoPlayer;
  if (!actual) return;
  actual.currentTime = Math.min(actual.duration, actual.currentTime + 10);
});

videoPlayer.addEventListener('timeupdate', () => {
  if (videoPlayer.duration && !esContenidoVivo) {
    playerSeek.value = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    playerCurrent.textContent = formatTime(videoPlayer.currentTime);
    playerTotal.textContent = formatTime(videoPlayer.duration);
  }
});

hlsPlayer.addEventListener('timeupdate', () => {
  if (hlsPlayer.duration && !esContenidoVivo) {
    playerSeek.value = (hlsPlayer.currentTime / hlsPlayer.duration) * 100;
    playerCurrent.textContent = formatTime(hlsPlayer.currentTime);
    playerTotal.textContent = formatTime(hlsPlayer.duration);
  }
});

playerSeek.addEventListener('input', () => {
  const actual = reproductorActivo === 'hls' ? hlsPlayer : videoPlayer;
  if (actual && actual.duration) {
    actual.currentTime = (playerSeek.value / 100) * actual.duration;
  }
});

playerVolume.addEventListener('input', () => {
  const vol = parseFloat(playerVolume.value);
  videoPlayer.volume = vol;
  hlsPlayer.volume = vol;
});

playerSpeed.addEventListener('change', () => {
  const vel = parseFloat(playerSpeed.value);
  videoPlayer.playbackRate = vel;
  hlsPlayer.playbackRate = vel;
});

playerQuality.addEventListener('change', () => {
  const valor = playerQuality.value;
  if (reproductorActivo !== 'hls' || !hlsInstance) {
    CONFIG_USUARIO.calidad = valor === '-1' ? 'auto' : valor;
    guardarConfig();
    return;
  }
  if (valor === '-1') {
    hlsInstance.currentLevel = -1;
    CONFIG_USUARIO.calidad = 'auto';
  } else {
    const idx = parseInt(valor, 10);
    hlsInstance.currentLevel = idx;
    const nivel = hlsInstance.levels[idx];
    CONFIG_USUARIO.calidad = nivel && nivel.height ? String(nivel.height) : 'auto';
  }
  guardarConfig();
});

const playerFullscreen = document.getElementById('player-fullscreen');
function actualizarIconoFullscreen() {
  playerFullscreen.innerHTML = document.fullscreenElement === playerOverlay
    ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
}
playerFullscreen.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await playerOverlay.requestFullscreen();
    else await document.exitFullscreen();
  } catch (err) { console.error(err); }
});
document.addEventListener('fullscreenchange', actualizarIconoFullscreen);

videoPlayer.addEventListener('click', () => {
  if (videoPlayer.paused) videoPlayer.play(); else videoPlayer.pause();
});
hlsPlayer.addEventListener('click', () => {
  if (hlsPlayer.paused) hlsPlayer.play(); else hlsPlayer.pause();
});

videoPlayer.addEventListener('play', () => playerPlay.innerHTML = '<i class="fa-solid fa-pause"></i>');
videoPlayer.addEventListener('pause', () => playerPlay.innerHTML = '<i class="fa-solid fa-play"></i>');
hlsPlayer.addEventListener('play', () => playerPlay.innerHTML = '<i class="fa-solid fa-pause"></i>');
hlsPlayer.addEventListener('pause', () => playerPlay.innerHTML = '<i class="fa-solid fa-play"></i>');

function formatTime(s) {
  if (!s || isNaN(s)) return '00:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ============================================================
// MINI REPRODUCTOR FLOTANTE (PICTURE-IN-PICTURE)
// ============================================================
function minimizarReproductor() {
  let url = null, titulo = playerTitle.textContent, tipo = 'video';

  if (reproductorActivo === 'video' && videoPlayer.src) {
    url = videoPlayer.src;
    tipo = esUrlHLS(url) ? 'hls' : 'video';
  } else if (reproductorActivo === 'hls') {
    if (hlsInstance && hlsInstance.url) {
      url = hlsInstance.url;
      tipo = 'hls';
    } else if (hlsPlayer.src) {
      url = hlsPlayer.src;
      tipo = 'hls';
    }
  } else if (reproductorActivo === 'webview') {
    alert('Los reproductores embebidos no se pueden minimizar');
    return;
  }

  if (!url) { alert('No hay nada reproduciéndose'); return; }

  urlActualMini = url;
  tituloActualMini = titulo;
  tipoActualMini = tipo;

  miniTitle.textContent = titulo || 'Reproduciendo...';
  miniPlayer.classList.remove('hidden');

  if (tipo === 'hls' && Hls.isSupported()) {
    if (miniHlsInstance) { miniHlsInstance.destroy(); miniHlsInstance = null; }
    miniHlsInstance = new Hls();
    miniHlsInstance.loadSource(url);
    miniHlsInstance.attachMedia(miniVideo);
    miniHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      miniVideo.play().catch(() => {});
    });
  } else {
    miniVideo.src = url;
    miniVideo.play().catch(() => {});
  }

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  playerOverlay.classList.add('hidden');
  limpiarReproductores();

  miniPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
}

document.getElementById('player-minimize').addEventListener('click', minimizarReproductor);

miniPlayBtn.addEventListener('click', () => {
  if (miniVideo.paused) {
    miniVideo.play();
    miniPlayBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  } else {
    miniVideo.pause();
    miniPlayBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  }
});

document.getElementById('mini-close').addEventListener('click', () => {
  try { miniVideo.pause(); miniVideo.src = ''; } catch (e) {}
  if (miniHlsInstance) { try { miniHlsInstance.destroy(); miniHlsInstance = null; } catch (e) {} }
  miniPlayer.classList.add('hidden');
  urlActualMini = null;
});

document.getElementById('mini-expand').addEventListener('click', () => {
  if (!urlActualMini) return;
  const url = urlActualMini;
  const titulo = tituloActualMini;
  try { miniVideo.pause(); miniVideo.src = ''; } catch (e) {}
  if (miniHlsInstance) { try { miniHlsInstance.destroy(); miniHlsInstance = null; } catch (e) {} }
  miniPlayer.classList.add('hidden');
  setTimeout(() => abrirReproductor(url, titulo, false), 200);
});

(function hacerArrastrable() {
  let isDown = false, startX, startY, origX, origY;
  miniPlayer.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDown = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = miniPlayer.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    miniPlayer.style.right = 'auto';
    miniPlayer.style.bottom = 'auto';
    miniPlayer.style.left = origX + 'px';
    miniPlayer.style.top = origY + 'px';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    miniPlayer.style.left = (origX + dx) + 'px';
    miniPlayer.style.top = (origY + dy) + 'px';
  });
  document.addEventListener('mouseup', () => { isDown = false; });
})();

// ============ NAVEGACIÓN ============
document.querySelectorAll('.bottom-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bottom-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    if (tab === 'peliculas') mostrarHome();
    else if (tab === 'series') mostrarSeries();
  });
});

// ============================================================
// 🚀 SISTEMA DE AUTO-ACTUALIZACIÓN
// ============================================================
const updateModal = document.getElementById('update-modal');
const updateTitle = document.getElementById('update-title');
const updateMessage = document.getElementById('update-message');
const updateVersionInfo = document.getElementById('update-version-info');
const updateVersionBadge = document.getElementById('update-version-badge');
const updateCurrentVersion = document.getElementById('update-current-version');
const updateProgressContainer = document.getElementById('update-progress-container');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateProgressText = document.getElementById('update-progress-text');
const updateButtons = document.getElementById('update-buttons');
const btnUpdateCancel = document.getElementById('btn-update-cancel');
const btnUpdatePrimary = document.getElementById('btn-update-primary');
const appVersionBadge = document.getElementById('app-version-badge');

let versionActual = '1.0.0';
let updateState = { status: 'idle', version: null };

(async () => {
  try {
    versionActual = await ipcRenderer.invoke('obtener-version-app');
    if (appVersionBadge) appVersionBadge.textContent = 'v' + versionActual;
    if (updateCurrentVersion) updateCurrentVersion.textContent = 'Actual: v' + versionActual;
    console.log('📌 Versión actual de la app:', versionActual);
  } catch (e) { console.error('Error obteniendo versión:', e); }
})();

function mostrarModalUpdate() { updateModal.classList.remove('hidden'); }
function ocultarModalUpdate() {
  updateModal.classList.add('hidden');
  updateProgressContainer.style.display = 'none';
  updateProgressFill.style.width = '0%';
  updateProgressText.textContent = '0%';
  updateButtons.style.display = 'flex';
  btnUpdateCancel.style.display = 'block';
  btnUpdatePrimary.style.display = 'block';
}

ipcRenderer.on('update-status', (event, data) => {
  console.log('📡 Update status:', data);
  updateState = data;

  switch (data.status) {
    case 'checking':
      updateTitle.textContent = 'Buscando actualizaciones...';
      updateMessage.textContent = data.message || 'Espera un momento';
      updateVersionInfo.style.display = 'none';
      updateProgressContainer.style.display = 'none';
      updateButtons.style.display = 'none';
      mostrarModalUpdate();
      break;

    case 'available':
      updateTitle.textContent = '🎉 ¡Actualización disponible!';
      updateMessage.textContent = data.message || 'Hay una nueva versión lista para descargar';
      updateVersionBadge.textContent = 'v' + data.version;
      updateCurrentVersion.textContent = 'Actual: v' + versionActual;
      updateVersionInfo.style.display = 'flex';
      updateProgressContainer.style.display = 'none';
      updateButtons.style.display = 'flex';
      btnUpdateCancel.style.display = 'block';
      btnUpdateCancel.textContent = 'Más tarde';
      btnUpdatePrimary.style.display = 'block';
      btnUpdatePrimary.textContent = 'Descargar';
      btnUpdatePrimary.disabled = false;
      mostrarModalUpdate();
      break;

    case 'not-available':
      updateTitle.textContent = '✅ Estás al día';
      updateMessage.textContent = data.message || 'Ya tienes la última versión';
      updateVersionInfo.style.display = 'none';
      updateProgressContainer.style.display = 'none';
      updateButtons.style.display = 'flex';
      btnUpdateCancel.style.display = 'none';
      btnUpdatePrimary.style.display = 'block';
      btnUpdatePrimary.textContent = 'Cerrar';
      btnUpdatePrimary.disabled = false;
      mostrarModalUpdate();
      break;

    case 'error':
      updateTitle.textContent = '❌ Error';
      updateMessage.textContent = data.message || 'No se pudo verificar';
      updateVersionInfo.style.display = 'none';
      updateProgressContainer.style.display = 'none';
      updateButtons.style.display = 'flex';
      btnUpdateCancel.style.display = 'none';
      btnUpdatePrimary.style.display = 'block';
      btnUpdatePrimary.textContent = 'Cerrar';
      btnUpdatePrimary.disabled = false;
      mostrarModalUpdate();
      break;

    case 'downloading':
      updateTitle.textContent = '📥 Descargando actualización...';
      updateMessage.textContent = 'No cierres la app';
      updateVersionInfo.style.display = 'flex';
      updateProgressContainer.style.display = 'block';
      const pct = data.percent || 0;
      updateProgressFill.style.width = pct.toFixed(1) + '%';
      updateProgressText.textContent = pct.toFixed(1) + '%';
      updateButtons.style.display = 'flex';
      btnUpdateCancel.style.display = 'none';
      btnUpdatePrimary.style.display = 'none';
      mostrarModalUpdate();
      break;

    case 'downloaded':
      updateTitle.textContent = '✅ ¡Listo para instalar!';
      updateMessage.textContent = 'La actualización se aplicará al reiniciar la app';
      updateVersionInfo.style.display = 'flex';
      updateVersionBadge.textContent = 'v' + data.version;
      updateProgressFill.style.width = '100%';
      updateProgressText.textContent = '100%';
      updateProgressContainer.style.display = 'block';
      updateButtons.style.display = 'flex';
      btnUpdateCancel.style.display = 'block';
      btnUpdateCancel.textContent = 'Reiniciar después';
      btnUpdatePrimary.style.display = 'block';
      btnUpdatePrimary.textContent = 'Reiniciar ahora';
      btnUpdatePrimary.disabled = false;
      mostrarModalUpdate();
      break;
  }
});

btnUpdateCancel.addEventListener('click', () => { ocultarModalUpdate(); });

btnUpdatePrimary.addEventListener('click', async () => {
  const status = updateState.status;
  if (status === 'available') {
    btnUpdatePrimary.disabled = true;
    btnUpdatePrimary.textContent = 'Iniciando...';
    await ipcRenderer.invoke('descargar-actualizacion');
  } else if (status === 'downloaded') {
    btnUpdatePrimary.disabled = true;
    btnUpdatePrimary.textContent = 'Reiniciando...';
    await ipcRenderer.invoke('instalar-actualizacion');
  } else {
    ocultarModalUpdate();
  }
});

document.getElementById('op-actualizaciones').addEventListener('click', async () => {
  cuentaOverlay.classList.add('hidden');
  updateState = { status: 'checking' };
  updateTitle.textContent = 'Buscando actualizaciones...';
  updateMessage.textContent = 'Espera un momento';
  updateVersionInfo.style.display = 'none';
  updateProgressContainer.style.display = 'none';
  updateButtons.style.display = 'none';
  mostrarModalUpdate();

  const res = await ipcRenderer.invoke('verificar-actualizaciones');
  if (!res.success) {
    updateState = { status: 'error' };
    updateTitle.textContent = '❌ Error';
    updateMessage.textContent = res.error || 'No se pudo verificar';
    updateButtons.style.display = 'flex';
    btnUpdateCancel.style.display = 'none';
    btnUpdatePrimary.style.display = 'block';
    btnUpdatePrimary.textContent = 'Cerrar';
    btnUpdatePrimary.disabled = false;
  }
});

// ============================================================
// 🔔 SISTEMA DE NOTIFICACIONES PUSH
// ============================================================
const notifOverlay = document.getElementById('notif-overlay');
const notifList = document.getElementById('notif-list');
const notifBadge = document.getElementById('notif-badge');
let notificaciones = [];
let unsubNotif = null;

document.getElementById('top-notif').addEventListener('click', async () => {
  notifOverlay.classList.remove('hidden');
  await cargarNotificaciones();
});

document.getElementById('cerrar-notif').addEventListener('click', () => {
  notifOverlay.classList.add('hidden');
});

notifOverlay.addEventListener('click', (e) => {
  if (e.target === notifOverlay) notifOverlay.classList.add('hidden');
});

document.getElementById('btn-marcar-leidas').addEventListener('click', async () => {
  await marcarTodasLeidas();
  await cargarNotificaciones();
});

async function cargarNotificaciones() {
  const user = auth.currentUser;
  if (!user) {
    notifList.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:40px;">Inicia sesión para ver tus notificaciones</p>';
    return;
  }

  notifList.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:40px;">Cargando...</p>';

  try {
    const notifRef = collection(firestore, 'user_notifications', user.uid, 'notifications');

    if (unsubNotif) { unsubNotif(); unsubNotif = null; }

    unsubNotif = onSnapshot(notifRef, (snapshot) => {
      const nuevas = [];
      snapshot.forEach(doc => {
        nuevas.push({ id: doc.id, ...doc.data() });
      });

      nuevas.sort((a, b) => {
        const tA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.createdAt || 0);
        const tB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.createdAt || 0);
        return tB - tA;
      });

      const notifsNoLeidas = nuevas.filter(n => !n.leida && !n.read);
      const idsPrevios = new Set(notificaciones.map(n => n.id));
      const notifsRecienLlegadas = notifsNoLeidas.filter(n => !idsPrevios.has(n.id));

      notificaciones = nuevas;

      const noLeidas = nuevas.filter(n => !n.leida && !n.read).length;
      if (noLeidas > 0) {
        notifBadge.textContent = noLeidas > 99 ? '99+' : noLeidas;
        notifBadge.style.display = 'flex';
      } else {
        notifBadge.style.display = 'none';
      }

      if (idsPrevios.size > 0) {
        notifsRecienLlegadas.forEach(n => {
          ipcRenderer.invoke('mostrar-notificacion', {
            titulo: n.titulo || n.title || 'Rayito Plus',
            mensaje: n.mensaje || n.body || n.message || '',
            icono: n.icono || n.icon || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'
          });
        });
      }

      renderNotificaciones();
    }, (err) => {
      console.error('Error en onSnapshot notif:', err);
      notifList.innerHTML = '<p style="color:#ef4444;text-align:center;padding:40px;">Error: ' + err.message + '</p>';
    });

  } catch (err) {
    console.error('Error cargando notificaciones:', err);
    notifList.innerHTML = '<p style="color:#ef4444;text-align:center;padding:40px;">Error: ' + err.message + '</p>';
  }
}

function renderNotificaciones() {
  if (notificaciones.length === 0) {
    notifList.innerHTML = '<p style="color:#9ca3af;text-align:center;padding:40px;">No tienes notificaciones</p>';
    return;
  }

  notifList.innerHTML = notificaciones.map(n => {
    const leida = n.leida || n.read;
    const titulo = n.titulo || n.title || 'Sin título';
    const mensaje = n.mensaje || n.body || n.message || '';
    const icono = n.icono || n.icon || 'https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg';
    const fecha = n.timestamp?.toDate
      ? n.timestamp.toDate().toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : (n.createdAt ? new Date(n.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Ahora');

    return `
      <div class="notif-item ${leida ? 'leida' : 'no-leida'}" data-id="${n.id}">
        <img src="${icono}" class="notif-item-icon" onerror="this.src='https://i.ibb.co/JRZxfPcM/ic-placeholder.jpg'">
        <div class="notif-item-body">
          <h4 class="notif-item-titulo">${titulo}</h4>
          <p class="notif-item-mensaje">${mensaje}</p>
          <span class="notif-item-fecha">${fecha}</span>
        </div>
        ${!leida ? '<span class="notif-item-punto"></span>' : ''}
      </div>`;
  }).join('');

  notifList.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      const notif = notificaciones.find(n => n.id === id);
      if (notif && !(notif.leida || notif.read)) {
        await marcarNotificacionLeida(id);
      }
    });
  });
}

async function marcarNotificacionLeida(id) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const ref = doc(firestore, 'user_notifications', user.uid, 'notifications', id);
    await updateDoc(ref, { leida: true, read: true, readAt: serverTimestamp() });
  } catch (e) {
    console.error('Error marcando notificación:', e);
  }
}

async function marcarTodasLeidas() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const noLeidas = notificaciones.filter(n => !(n.leida || n.read));
    for (const n of noLeidas) {
      const ref = doc(firestore, 'user_notifications', user.uid, 'notifications', n.id);
      await updateDoc(ref, { leida: true, read: true, readAt: serverTimestamp() });
    }
  } catch (e) {
    console.error('Error marcando todas:', e);
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    setTimeout(() => cargarNotificaciones(), 1500);
  } else {
    if (unsubNotif) { unsubNotif(); unsubNotif = null; }
    notificaciones = [];
    notifBadge.style.display = 'none';
  }
});

console.log('✅ Rayito Plus listo con reproductor HLS + WebView + Mini Player + Auto-Update + Notificaciones');
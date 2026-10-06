const axios = require('axios');

const BASE_URL = 'https://rayitofilms.online';
const USER_AGENT = 'RayitoPlusApp/3.0.7 Electron';

// ============ PELÍCULAS ============
async function cargarPeliculas() {
  try {
    console.log('🔐 Solicitando token para películas...');
    const tokenRes = await axios.get(`${BASE_URL}/generate/movies.json`, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000
    });
    const verifyToken = tokenRes.data.verify;

    console.log('📥 Descargando películas...');
    const res = await axios.get(`${BASE_URL}/movies.json`, {
      params: { verify: verifyToken },
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 15000
    });

    const moviesMap = res.data;
    const movies = [];
    for (const key in moviesMap) {
      if (moviesMap[key]) {
        moviesMap[key].id = key;
        movies.push(moviesMap[key]);
      }
    }
    console.log(`✅ ${movies.length} películas cargadas`);
    return movies;
  } catch (error) {
    console.error('❌ Error cargando películas:', error.message);
    throw new Error('No se pudieron cargar las películas');
  }
}

// ============ SERIES ============
async function cargarSeries() {
  try {
    console.log('🔐 Solicitando token para series...');
    const tokenRes = await axios.get(`${BASE_URL}/generate/series.json`, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 15000
    });
    const verifyToken = tokenRes.data.verify;

    console.log('📥 Descargando series...');
    const res = await axios.get(`${BASE_URL}/series.json`, {
      params: { verify: verifyToken },
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      timeout: 15000
    });

    const seriesMap = res.data;
    const series = [];
    for (const key in seriesMap) {
      if (seriesMap[key]) {
        seriesMap[key].id = key;
        series.push(seriesMap[key]);
      }
    }
    console.log(`✅ ${series.length} series cargadas`);
    return series;
  } catch (error) {
    console.error('❌ Error cargando series:', error.message);
    throw new Error('No se pudieron cargar las series');
  }
}

module.exports = { cargarPeliculas, cargarSeries };
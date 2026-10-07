const axios = require('axios');

const PROTO = 'https://';
const HOST = 'rayitofilms' + '.online';
const BASE_URL = PROTO + HOST;
const UA = 'RayitoPlusApp/' + '3.0.7' + ' Electron';

const R_MOVIES_GEN = '/pc/generate/' + 'movies.json';
const R_SERIES_GEN = '/pc/generate/' + 'series.json';
const R_MOVIES = '/pc/' + 'movies.json';
const R_SERIES = '/pc/' + 'series.json';

const log = () => {};

async function cargarPeliculas() {
  try {
    log('🔐 Solicitando token...');
    const tokenRes = await axios.get(BASE_URL + R_MOVIES_GEN, {
      headers: { 'User-Agent': UA },
      timeout: 15000
    });
    const verifyToken = tokenRes.data.verify;

    log('📥 Descargando películas...');
    const res = await axios.get(BASE_URL + R_MOVIES, {
      params: { verify: verifyToken },
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json'
      },
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
    log(`✅ ${movies.length} películas cargadas`);
    return movies;
  } catch (error) {
    log('❌ Error:', error.message);
    throw new Error('No se pudieron cargar las películas');
  }
}

async function cargarSeries() {
  try {
    log('🔐 Solicitando token...');
    const tokenRes = await axios.get(BASE_URL + R_SERIES_GEN, {
      headers: { 'User-Agent': UA },
      timeout: 15000
    });
    const verifyToken = tokenRes.data.verify;

    log('📥 Descargando series...');
    const res = await axios.get(BASE_URL + R_SERIES, {
      params: { verify: verifyToken },
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json'
      },
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
    log(`✅ ${series.length} series cargadas`);
    return series;
  } catch (error) {
    log('❌ Error:', error.message);
    throw new Error('No se pudieron cargar las series');
  }
}

module.exports = { cargarPeliculas, cargarSeries };
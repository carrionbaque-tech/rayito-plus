// obfuscate.js
// Ofusca los archivos JS de Rayito Plus
// Uso: npm run obfuscate

const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// ============ CONFIGURACIÓN ============
const ARCHIVOS_A_OFUSCAR = [
  'main.js',
  'renderer.js',
  'cloudflare-manager.js'
];

const ARCHIVOS_A_COPIAR = [
  'firebase-config.js'
];

const OUTPUT_DIR = path.join(__dirname, 'app-obfuscated');

// Opciones de ofuscación (ajustadas para Electron)
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,          // ⚠️ OBLIGATORIO false para Electron
  selfDefending: false,          // ⚠️ OBLIGATORIO false para Electron
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// ============ LÓGICA ============
function limpiarDirectorio(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  console.log('\n🔒 Iniciando ofuscación de Rayito Plus...\n');

  // Limpiar carpeta de salida
  console.log('🧹 Limpiando carpeta app-obfuscated...');
  limpiarDirectorio(OUTPUT_DIR);

  let ok = 0;
  let errores = 0;

  // Ofuscar archivos
  ARCHIVOS_A_OFUSCAR.forEach(archivo => {
    const inputPath = path.join(__dirname, archivo);
    const outputPath = path.join(OUTPUT_DIR, archivo);

    if (!fs.existsSync(inputPath)) {
      console.error(`❌ No existe: ${archivo}`);
      errores++;
      return;
    }

    try {
      const code = fs.readFileSync(inputPath, 'utf8');
      const resultado = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
      fs.writeFileSync(outputPath, resultado.getObfuscatedCode(), 'utf8');

      const sizeOrig = fs.statSync(inputPath).size;
      const sizeOfus = fs.statSync(outputPath).size;
      const ratio = ((sizeOfus / sizeOrig) * 100).toFixed(0);

      console.log(`🔒 ${archivo} → ${(sizeOrig/1024).toFixed(1)}KB → ${(sizeOfus/1024).toFixed(1)}KB (${ratio}%)`);
      ok++;
    } catch (err) {
      console.error(`❌ Error ofuscando ${archivo}:`, err.message);
      errores++;
    }
  });

  // Copiar archivos excluidos
  ARCHIVOS_A_COPIAR.forEach(archivo => {
    const inputPath = path.join(__dirname, archivo);
    const outputPath = path.join(OUTPUT_DIR, archivo);

    if (fs.existsSync(inputPath)) {
      fs.copyFileSync(inputPath, outputPath);
      console.log(`📋 ${archivo} (copiado sin ofuscar)`);
      ok++;
    }
  });

  console.log(`\n✅ Ofuscación completa: ${ok} archivos procesados, ${errores} errores`);
  console.log(`📁 Resultado en: app-obfuscated/\n`);

  if (errores > 0) process.exit(1);
}

main();
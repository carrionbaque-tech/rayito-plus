// obfuscate.js
const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ARCHIVOS_A_OFUSCAR = [
  'cloudflare-manager.js',  
  'renderer.js',
  'donaciones.js',
   'chat.js', 
   
];

const ARCHIVOS_A_COPIAR = [
  'main.js',                
  'firebase-config.js',     
];

const OUTPUT_DIR = path.join(__dirname, 'app-obfuscated');


const OBFUSCATION_OPTIONS_CLOUDFLARE = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,       
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.6,      
  debugProtection: true,                    
  debugProtectionInterval: 2000,            
  disableConsoleOutput: true,            
  identifierNamesGenerator: 'mangled-shuffled',
  log: false,
  numbersToExpressions: true,
  renameGlobals: true,                     
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,       
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,
  stringArrayEncoding: ['rc4'],             
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,               
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 5,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,                  
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  
  target: 'node',
  sourceMap: false,
  seed: 0,
};


const OBFUSCATION_OPTIONS_DEFAULT = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  target: 'node',
};

function limpiarDirectorio(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function ofuscarArchivo(archivo, opciones) {
  const inputPath = path.join(__dirname, archivo);
  const outputPath = path.join(OUTPUT_DIR, archivo);

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ No existe: ${archivo}`);
    return false;
  }

  try {
    const code = fs.readFileSync(inputPath, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(code, opciones).getObfuscatedCode();
    fs.writeFileSync(outputPath, obfuscated);
    const s1 = (fs.statSync(inputPath).size / 1024).toFixed(1);
    const s2 = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`🔒 ${archivo}: ${s1}KB → ${s2}KB`);
    return true;
  } catch (err) {
    console.error(`❌ Error ofuscando ${archivo}:`, err.message);
    return false;
  }
}

function copiarArchivo(archivo) {
  const inputPath = path.join(__dirname, archivo);
  const outputPath = path.join(OUTPUT_DIR, archivo);
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ No existe: ${archivo}`);
    return false;
  }
  fs.copyFileSync(inputPath, outputPath);
  console.log(`📋 ${archivo} copiado`);
  return true;
}

function main() {
  console.log('\n🛡️  RAYITO PLUS - Build Seguro\n');
  limpiarDirectorio(OUTPUT_DIR);

  let ok = 0, errores = 0;

  ARCHIVOS_A_OFUSCAR.forEach(a => {
    const opts = a === 'cloudflare-manager.js'
      ? OBFUSCATION_OPTIONS_CLOUDFLARE
      : OBFUSCATION_OPTIONS_DEFAULT;
    if (ofuscarArchivo(a, opts)) ok++; else errores++;
  });

  ARCHIVOS_A_COPIAR.forEach(a => {
    if (copiarArchivo(a)) ok++; else errores++;
  });

  console.log(`\n✅ ${ok} procesados, ${errores} errores\n`);
  if (errores > 0) process.exit(1);
}

main();
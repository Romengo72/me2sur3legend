// C:\Me\AppMoney\MeParisPortifs\check-routes.js
const fs = require('fs');
const path = require('path');

const files = [
  'routes-public', 'routes-auth', 'routes-security', 'routes-withdrawal',
  'routes-deposit', 'routes-payment', 'routes-core', 'routes-historique',
  'routes-matches', 'routes-ia', 'routes-ia-generator', 'routes-user',
  'routes-admin', 'routes-finance', 'routes-odds-generator'
];

console.log('🔍 Vérification de l\'export des routeurs...\n');

files.forEach(file => {
  const fullPath = path.join(__dirname, `${file}.js`);
  if (!fs.existsSync(fullPath)) {
    console.log(`❌ ${file}.js : Fichier manquant`);
    return;
  }
  try {
    const module = require(`./${file}`);
    if (typeof module === 'function') {
      console.log(`✅ ${file}.js : OK (Router Express)`);
    } else {
      console.log(`❌ ${file}.js : ERREUR (Exporte un ${typeof module}, pas un Router). Ajoutez 'module.exports = router;' à la fin du fichier.`);
    }
  } catch (e) {
    console.log(`❌ ${file}.js : ERREUR DE SYNTAXE -> ${e.message}`);
  }
});
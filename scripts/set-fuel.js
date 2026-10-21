const { openMemory } = require('../modules/memory');
const { initFuel, setFuelBalance } = require('../modules/fuel');
const argument = process.argv[2];
if (!argument || !/^\d+(?:[.,]\d{1,4})?$/.test(argument)) {
  console.error('Użycie: node scripts/set-fuel.js 10.50');
  process.exitCode = 1;
} else {
  const db = openMemory();
  try {
    initFuel(db);
    const balance = Number(argument.replace(',', '.'));
    setFuelBalance(db, balance);
    console.log(`Saldo startowe: ${balance.toFixed(2)} USD. Wcześniejsze koszty nie zostaną odjęte ponownie.`);
  } finally { db.close(); }
}

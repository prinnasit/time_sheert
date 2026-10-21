// tests/fixtures.js
const mappingText = [
  'WO No.\tCategory\tWO Name',
  'CAPEX-001\tCAPEX\tONE Corporate MVP1',
  'CAPEX-002\tCAPEX\tKBank Mobile Revamp',
  'OPEX-001\tOPEX\tProduction Support',
  'Z01\tNon Charge\tLeave / Day-Off',
  'Z02\tNon Charge\tTraining / Meeting'
].join('\n');

function dayRow(name, sq, woNo, woName, fte, values) {
  const days = new Array(31).fill('0');
  Object.keys(values).forEach(k => { days[Number(k) - 1] = String(values[k]); });
  return [name, sq, woNo, woName, fte, ...days].join('\t');
}

const timesheetText = [
  'Name-Surname\tSQ\tWO No.\tWO Name\tFTE/OS\t...(31 daily columns)',
  dayRow('Somchai Jaidee', 'KSB_Elephant', 'CAPEX-001', 'ONE Corporate MVP1', '1', { 1: 8, 2: 8, 3: 8 }),
  dayRow('Somsri Rakthai', 'KSB_Elephant', 'OPEX-001', 'Production Support', '1', { 1: 4, 2: 4 }),
  dayRow('Anan Chai', 'KSB_Orca', 'CAPEX-002', 'KBank Mobile Revamp', '1', { 1: 8, 2: 8, 3: 8, 4: 8 }),
  dayRow('Anan Chai', 'KSB_Orca', 'Z01', 'Leave / Day-Off', '1', { 5: 8 }),
  dayRow('Piti Suk', 'KSB_Pony', 'CAPEX-001', 'ONE Corporate MVP1', '1', { 1: 8, 2: 8 }),
  dayRow('Piti Suk', 'KSB_Pony', 'Z02', 'Training / Meeting', '1', { 3: 4 }),
  dayRow('Malee Somsri', 'KSB_Lead', 'W999-UNKNOWN', 'Some Unknown WO', '1', { 1: 8, 2: 8 })
].join('\n');

// Fake settings (the real WO list, people and ceilings live in a private
// .json file that is never committed). Same shape as the settings file.
const settingsSample = {
  version: 1,
  woMapping: [
    { wo: 'WO-C1', category: 'CAPEX', name: 'Sample capex project' },
    { wo: 'WO-O1', category: 'OPEX', name: 'Sample support' },
    { wo: 'WO-Z1', category: 'Non Charge', name: 'Leave' }
  ],
  roleCeilings: [
    { role: 'Automated Tester', z: 3, capex: 14, opex: 3 },
    { role: 'Developer', z: 2, capex: 16, opex: 2 },
    { role: 'Incident Management Engineer', z: 1, capex: 0, opex: 19 },
    { role: 'Quality Assurance Lead', z: 8, capex: 9.6, opex: 2.4 }
  ],
  people: [
    { name: 'Person One', role: 'Developer' },
    { name: 'Person Two', role: 'Automated Tester' }
  ]
};
const settingsRoleCeilingRows = settingsSample.roleCeilings.map(r => [r.role, String(r.z), String(r.capex), String(r.opex)]);

module.exports = { mappingText, timesheetText, settingsSample, settingsRoleCeilingRows };

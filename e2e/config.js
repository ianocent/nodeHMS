const path = require('path');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

module.exports = {
  FRONTEND_URL: getArg('fe', 'http://localhost:3000'),
  BACKEND_URL: getArg('be', 'http://localhost:3001'),
  USERNAME: getArg('user', 'developer7'),
  PASSWORD: getArg('pass', 'P@ssw0rdHMS25'),
  PROPERTY_NAME: getArg('property', 'Anyaman'),
  PROPERTY_CODE: getArg('code', '1000'),
  TC_DIR: path.resolve(__dirname, '..', '..', 'TC'),
  REPORT_DIR: path.join(__dirname, 'reports'),
  SHOT_DIR: path.join(__dirname, 'reports', 'screenshots'),
  HEADLESS: !args.includes('--headed'),
  START_SHIFT: args.includes('--start-shift'),
  STEP_TIMEOUT: parseInt(getArg('timeout', '15000'), 10),
  FILE_FILTER: getArg('file', ''),
  TC_FILTER: getArg('tc', ''),
  MAX_CASES: parseInt(getArg('max', '0'), 10),
};

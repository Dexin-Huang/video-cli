#!/usr/bin/env node

const os = require('node:os');
const path = require('node:path');
const { loadEnvFile } = require('./src/lib/env');
const { main } = require('./src/cli');

loadEnvFile(process.cwd(), path.join(os.homedir(), '.video-cli'), __dirname);

main(process.argv.slice(2)).catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

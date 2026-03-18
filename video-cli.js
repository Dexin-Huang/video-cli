#!/usr/bin/env node

const { loadEnvFile } = require('./src/lib/env');
const { main } = require('./src/cli');

loadEnvFile(__dirname);

main(process.argv.slice(2)).catch(error => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});

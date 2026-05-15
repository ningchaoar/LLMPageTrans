const fs = require('fs');
const path = require('path');

const tests = [];

global.test = function test(name, fn) {
  tests.push({ name, fn });
};

global.assertEqual = function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Values differ'}\nExpected: ${expected}\nActual: ${actual}`);
  }
};

global.assertDeepEqual = function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);
  if (actualJson !== expectedJson) {
    throw new Error(`${message || 'Objects differ'}\nExpected: ${expectedJson}\nActual: ${actualJson}`);
  }
};

function loadTestFiles() {
  const testDir = __dirname;
  fs.readdirSync(testDir)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .forEach((file) => {
      require(path.join(testDir, file));
    });
}

async function run() {
  loadTestFiles();

  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${entry.name}`);
      console.error(error.stack || error.message);
    }
  }

  const passed = tests.length - failed;
  console.log(`${passed}/${tests.length} tests passed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run();

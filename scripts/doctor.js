#!/usr/bin/env node
// ──────────────────────────────────────────────────────
//  Clui CC — Environment Doctor (Cross-Platform)
//
//  Read-only diagnostics. Checks all prerequisites
//  and reports status. No installs, no side effects.
//
//  Usage:  node scripts/doctor.js
// ──────────────────────────────────────────────────────

'use strict';

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Configuration ──

const MIN_NODE = '18.0.0';
const PLATFORM = os.platform();   // 'win32', 'darwin', 'linux'
const ARCH = os.arch();            // 'x64', 'arm64', etc.

// ── State ──

let failCount = 0;

// ── Helpers ──

function pad(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function pass(label, detail) {
  console.log(`  \x1b[32m[PASS]\x1b[0m  ${pad(label, 18)} ${detail}`);
}

function fail(label, detail) {
  console.log(`  \x1b[31m[FAIL]\x1b[0m  ${pad(label, 18)} ${detail}`);
  failCount++;
}

function warn(label, detail) {
  console.log(`  \x1b[33m[WARN]\x1b[0m  ${pad(label, 18)} ${detail}`);
}

function info(label, detail) {
  console.log(`  \x1b[36m[INFO]\x1b[0m  ${pad(label, 18)} ${detail}`);
}

/**
 * On Windows, commands like npm/npx are .cmd batch shims that
 * execFileSync cannot launch without shell: true.  We detect
 * this case and enable shell only for .cmd files.  Since all
 * commands are hardcoded (never user input), this is safe.
 */
function isCmdShim(cmd) {
  if (PLATFORM !== 'win32') return false;
  if (path.extname(cmd).toLowerCase() === '.cmd') return true;
  // Check if a .cmd shim exists on PATH for this bare command
  try {
    const out = execFileSync('where', [`${cmd}.cmd`], {
      encoding: 'utf8', timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }).trim();
    return !!out;
  } catch { return false; }
}

/**
 * Safely run a command and return trimmed stdout, or null on failure.
 * Uses execFileSync; enables shell only for Windows .cmd shims.
 * All probed commands are hardcoded constants, never user input.
 */
function probe(cmd, args, options) {
  try {
    const needsShell = isCmdShim(cmd);
    const result = execFileSync(cmd, args || [], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: needsShell,
      ...options,
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a command exists in PATH.
 * Returns the resolved path or null.
 */
function which(cmd) {
  const whichCmd = PLATFORM === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(whichCmd, [cmd], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // 'where' on Windows may return multiple lines; take the first
    const firstLine = result.trim().split(/\r?\n/)[0];
    return firstLine || null;
  } catch {
    return null;
  }
}

/**
 * Compare semver strings: returns true if current >= required.
 */
function versionGte(current, required) {
  if (!current || !required) return false;
  const parse = (v) => v.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const c = parse(current);
  const r = parse(required);
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] || 0;
    const rv = r[i] || 0;
    if (cv > rv) return true;
    if (cv < rv) return false;
  }
  return true; // equal
}

// ── Checks ──

function checkOS() {
  const release = os.release();
  const type = os.type();

  if (PLATFORM === 'darwin') {
    const ver = probe('sw_vers', ['-productVersion']);
    if (ver && versionGte(ver, '13.0')) {
      pass('OS', `macOS ${ver} (${ARCH})`);
    } else {
      fail('OS', `macOS ${ver || 'unknown'} -- requires 13+`);
    }
  } else if (PLATFORM === 'win32') {
    // Windows version from os.release() gives kernel version (e.g., 10.0.22621)
    const build = release.split('.').pop();
    let winName = 'Windows';
    const majorMinor = release.split('.').slice(0, 2).join('.');
    if (majorMinor === '10.0') {
      winName = parseInt(build) >= 22000 ? 'Windows 11' : 'Windows 10';
    }
    pass('OS', `${winName} (Build ${build}, ${ARCH})`);
  } else {
    info('OS', `${type} ${release} (${ARCH}) -- community supported`);
  }
}

function checkNode() {
  const ver = process.version.replace(/^v/, '');
  if (versionGte(ver, MIN_NODE)) {
    pass('Node.js', `v${ver}`);
  } else {
    const fix = PLATFORM === 'win32'
      ? 'winget install OpenJS.NodeJS.LTS'
      : 'brew install node';
    fail('Node.js', `v${ver} -- requires ${MIN_NODE}+ -- ${fix}`);
  }
}

function checkNpm() {
  const ver = probe('npm', ['--version']);
  if (ver) {
    pass('npm', ver);
  } else {
    const fix = PLATFORM === 'win32'
      ? 'winget install OpenJS.NodeJS.LTS'
      : 'brew install node';
    fail('npm', `not found -- ${fix}`);
  }
}

function checkPython() {
  // Try python3 first, then python (Windows often only has 'python')
  let cmd = null;
  let ver = null;

  for (const candidate of ['python3', 'python']) {
    const raw = probe(candidate, ['--version']);
    if (raw && raw.includes('Python 3')) {
      cmd = candidate;
      ver = raw.replace('Python ', '').trim();
      break;
    }
  }

  if (cmd && ver) {
    pass('Python 3', `${ver} (${cmd})`);

    // Check distutils (only relevant pre-3.12, but still useful)
    const distResult = probe(cmd, ['-c', 'import distutils; print("ok")']);
    if (distResult === 'ok') {
      pass('distutils', 'importable');
    } else {
      // Try setuptools as fallback (Python 3.12+ removed distutils)
      const setupResult = probe(cmd, ['-c', 'import setuptools; print("ok")']);
      if (setupResult === 'ok') {
        pass('setuptools', 'importable (distutils replacement)');
      } else {
        warn('distutils', `missing -- ${cmd} -m pip install setuptools`);
      }
    }
  } else {
    const fix = PLATFORM === 'win32'
      ? 'winget install Python.Python.3.11'
      : 'brew install python@3.11';
    fail('Python 3', `not found -- ${fix}`);
  }
}

function checkClaude() {
  const claudePath = which('claude');
  if (claudePath) {
    const ver = probe('claude', ['--version']);
    pass('Claude CLI', ver || 'found');
  } else {
    fail('Claude CLI', 'not found -- npm install -g @anthropic-ai/claude-code');
  }
}

function checkWhisper() {
  for (const cmd of ['whisperkit-cli', 'whisper-cli', 'whisper', 'whisper-cpp']) {
    if (which(cmd)) {
      pass('Whisper', `${cmd} found`);
      return;
    }
  }
  const fix = PLATFORM === 'darwin'
    ? 'brew install whisperkit-cli'
    : 'See https://github.com/ggerganov/whisper.cpp/releases';
  warn('Whisper', `not found (optional, for voice input) -- ${fix}`);
}

function checkMacBuildTools() {
  if (PLATFORM !== 'darwin') return;

  // Xcode CLT
  const xcPath = probe('xcode-select', ['-p']);
  if (xcPath) {
    pass('Xcode CLT', xcPath);
  } else {
    fail('Xcode CLT', 'not installed -- xcode-select --install');
  }

  // macOS SDK
  const sdkPath = probe('xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
  if (sdkPath) {
    pass('macOS SDK', sdkPath);
  } else {
    fail('macOS SDK', 'not found -- reinstall Xcode CLT');
  }

  // clang++
  const clangPath = which('clang++');
  if (clangPath) {
    const clangVer = probe('clang++', ['--version']);
    const firstLine = clangVer ? clangVer.split('\n')[0] : 'found';
    pass('clang++', firstLine);
  } else {
    fail('clang++', 'not found -- xcode-select --install');
  }
}

function checkWindowsBuildTools() {
  if (PLATFORM !== 'win32') return;

  // Check for Visual Studio C++ Build Tools via vswhere
  const vsWherePaths = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
  ];

  let found = false;
  for (const vsWhere of vsWherePaths) {
    if (fs.existsSync(vsWhere)) {
      const result = probe(vsWhere, [
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'displayName',
      ]);
      if (result) {
        const name = result.split('\n')[0].trim();
        pass('C++ Build Tools', name);
        found = true;
        break;
      }
    }
  }

  if (!found) {
    // Check via npm config as fallback
    const msvsVer = probe('npm', ['config', 'get', 'msvs_version']);
    if (msvsVer && msvsVer !== 'undefined') {
      pass('C++ Build Tools', `npm msvs_version: ${msvsVer}`);
      found = true;
    }
  }

  if (!found) {
    warn('C++ Build Tools', 'not detected -- may be needed for native modules');
    console.log('              Install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/');
  }
}

function checkNodeModules() {
  const repoRoot = path.resolve(__dirname, '..');
  const nodeModulesPath = path.join(repoRoot, 'node_modules');

  if (fs.existsSync(nodeModulesPath)) {
    // Check electron and electron-builder versions
    try {
      const electronPkg = path.join(nodeModulesPath, 'electron', 'package.json');
      const builderPkg = path.join(nodeModulesPath, 'electron-builder', 'package.json');

      if (fs.existsSync(electronPkg)) {
        const eVer = JSON.parse(fs.readFileSync(electronPkg, 'utf8')).version;
        pass('electron', `v${eVer}`);
      } else {
        warn('electron', 'not installed -- run npm install');
      }

      if (fs.existsSync(builderPkg)) {
        const bVer = JSON.parse(fs.readFileSync(builderPkg, 'utf8')).version;
        pass('electron-builder', `v${bVer}`);
      } else {
        warn('electron-builder', 'not installed -- run npm install');
      }
    } catch {
      warn('node_modules', 'exists but could not read package versions');
    }
  } else {
    warn('node_modules', 'not found -- run npm install or setup script');
  }
}

// ── Main ──

function main() {
  console.log('');
  console.log('Clui CC Environment Check');
  console.log('=========================');
  console.log('');

  console.log('  System');
  console.log('  ------');
  checkOS();
  console.log('');

  console.log('  Runtime');
  console.log('  -------');
  checkNode();
  checkNpm();
  checkPython();
  console.log('');

  console.log('  Build Tools');
  console.log('  -----------');
  checkMacBuildTools();
  checkWindowsBuildTools();
  console.log('');

  console.log('  Application');
  console.log('  -----------');
  checkClaude();
  checkWhisper();
  checkNodeModules();
  console.log('');

  // ── Summary ──

  console.log('─'.repeat(50));
  console.log('');

  if (failCount > 0) {
    console.log(`  \x1b[31m${failCount} check(s) failed.\x1b[0m Fix the issues above, then rerun:`);
    console.log('');
    if (PLATFORM === 'win32') {
      console.log('    .\\commands\\setup.bat');
    } else {
      console.log('    ./commands/setup.command');
    }
    console.log('');
    process.exit(1);
  } else {
    console.log('  \x1b[32mEnvironment looks good.\x1b[0m');
    console.log('');
    process.exit(0);
  }
}

main();

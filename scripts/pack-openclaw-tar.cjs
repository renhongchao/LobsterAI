'use strict';

/**
 * pack-openclaw-tar.cjs
 *
 * Packs a directory into a single .tar file for Windows distribution.
 * NSIS installs thousands of small files very slowly on NTFS; shipping one
 * tar archive and extracting it post-install is dramatically faster.
 *
 * Used by electron-builder-hooks beforePack to pack:
 *   - OpenClaw runtime (vendor/openclaw-runtime/current -> cfmind.tar)
 *   - SKILLs directory (SKILLs -> skills.tar)
 *   - Python runtime (resources/python-win -> python-win.tar)
 *
 * Usage (standalone):
 *   node scripts/pack-openclaw-tar.cjs [sourceDir] [outputTar]
 *
 * The tar is NOT gzip-compressed — the outer NSIS 7z solid archive already
 * compresses, so double-compression would only waste CPU.
 */

const fs = require('fs');
const path = require('path');

// ── Minimal tar writer ──────────────────────────────────────────────────────
// Implements just enough of the POSIX ustar format to pack regular files and
// directories.  No external dependencies.

const BLOCK = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK, 0);

function toOctal(num, len) {
  return num.toString(8).padStart(len - 1, '0') + '\0';
}

function createHeader(name, size, mode, type) {
  // type: '0' = regular file, '5' = directory
  const buf = Buffer.alloc(BLOCK, 0);

  // If name > 100 chars, use prefix field (max 155) + name (max 100)
  let prefix = '';
  let shortName = name;
  if (Buffer.byteLength(name) > 100) {
    const sepIdx = name.lastIndexOf('/', name.length - 2);
    if (sepIdx > 0) {
      prefix = name.slice(0, sepIdx);
      shortName = name.slice(sepIdx + 1);
    }
  }

  buf.write(shortName, 0, 100);                  // name
  buf.write(toOctal(mode, 8), 100, 8);            // mode
  buf.write(toOctal(0, 8), 108, 8);               // uid
  buf.write(toOctal(0, 8), 116, 8);               // gid
  buf.write(toOctal(size, 12), 124, 12);           // size
  buf.write(toOctal(Math.floor(Date.now() / 1000), 12), 136, 12); // mtime
  buf.write('        ', 148, 8);                   // checksum placeholder
  buf.write(type, 156, 1);                         // typeflag
  buf.write('ustar\0', 257, 6);                    // magic
  buf.write('00', 263, 2);                          // version
  if (prefix) {
    buf.write(prefix, 345, 155);                   // prefix
  }

  // Compute checksum
  let chksum = 0;
  for (let i = 0; i < BLOCK; i++) {
    chksum += buf[i];
  }
  buf.write(toOctal(chksum, 7), 148, 7);
  buf[155] = 0x20; // trailing space

  return buf;
}

function padBlock(size) {
  const remainder = size % BLOCK;
  if (remainder === 0) return Buffer.alloc(0);
  return Buffer.alloc(BLOCK - remainder, 0);
}

function packDirectory(sourceDir, outputTar) {
  const fd = fs.openSync(outputTar, 'w');
  let totalFiles = 0;
  let totalDirs = 0;

  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    // Sort for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const tarPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        // Skip symlinks — Windows NTFS junctions and symlinks in node_modules
        // cause issues; the runtime doesn't need .bin symlinks.
        continue;
      }

      if (entry.isDirectory()) {
        const dirHeader = createHeader(tarPath + '/', 0, 0o755, '5');
        fs.writeSync(fd, dirHeader);
        totalDirs++;
        walk(fullPath, tarPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const fileSize = stat.size;
        const header = createHeader(tarPath, fileSize, 0o644, '0');
        fs.writeSync(fd, header);

        // Stream file content in chunks to avoid loading large files into memory
        const CHUNK = 1024 * 1024; // 1 MB
        const readFd = fs.openSync(fullPath, 'r');
        let offset = 0;
        while (offset < fileSize) {
          const toRead = Math.min(CHUNK, fileSize - offset);
          const chunk = Buffer.alloc(toRead);
          fs.readSync(readFd, chunk, 0, toRead, offset);
          fs.writeSync(fd, chunk);
          offset += toRead;
        }
        fs.closeSync(readFd);

        // Pad to 512-byte boundary
        const pad = padBlock(fileSize);
        if (pad.length > 0) {
          fs.writeSync(fd, pad);
        }

        totalFiles++;
      }
    }
  }

  walk(sourceDir, '');

  // End-of-archive marker: two zero blocks
  fs.writeSync(fd, ZERO_BLOCK);
  fs.writeSync(fd, ZERO_BLOCK);
  fs.closeSync(fd);

  return { totalFiles, totalDirs };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const projectRoot = path.join(__dirname, '..');
  const sourceDir = process.argv[2]
    || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'current');
  const outputTar = process.argv[3]
    || path.join(projectRoot, 'vendor', 'openclaw-runtime', 'cfmind.tar');

  if (!fs.existsSync(sourceDir)) {
    console.error(`[pack-openclaw-tar] Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  console.log(`[pack-openclaw-tar] Packing: ${sourceDir}`);
  console.log(`[pack-openclaw-tar] Output:  ${outputTar}`);

  const t0 = Date.now();
  const { totalFiles, totalDirs } = packDirectory(sourceDir, outputTar);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const stat = fs.statSync(outputTar);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);

  console.log(
    `[pack-openclaw-tar] Done in ${elapsed}s: ${totalFiles} files, ${totalDirs} dirs, ${sizeMB} MB`
  );
}

// Only run main() when invoked directly (not when require()'d by another module)
if (require.main === module) {
  main();
}

module.exports = { packDirectory };

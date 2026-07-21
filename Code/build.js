const fs = require('fs');
const path = require('path');
const { refreshMonthLinesCache } = require('./server');

const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

function copyRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function build() {
  await refreshMonthLinesCache().catch(() => {});

  fs.rmSync(distDir, { recursive: true, force: true });
  copyRecursive(publicDir, distDir);

  console.log(`Build complete. Static assets copied to ${path.relative(rootDir, distDir)}`);
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});

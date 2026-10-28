// Inlines the stylesheet and scripts into one self-contained page: dist/index.html
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'src');
const out = path.join(__dirname, 'dist', 'index.html');

function bundle() {
  return fs.readFileSync(path.join(src, 'index.html'), 'utf8').replace(
    /<!-- inline: ([\w.-]+) -->/g,
    (_, file) => {
      const text = fs.readFileSync(path.join(src, file), 'utf8').trimEnd();
      if (file.endsWith('.css')) return `<style>\n${text}\n</style>`;
      if (text.includes('</script')) throw new Error(`${file} contains "</script"`);
      return `<script>\n${text}\n</script>`;
    }
  );
}

if (require.main === module) {
  const html = bundle();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Wrote ${path.relative(__dirname, out)} (${(html.length / 1024).toFixed(1)} KB)`);
}

module.exports = { bundle, out };

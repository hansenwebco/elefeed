const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function build() {
    const distDir = path.join(__dirname, 'dist');
    
    // 1. Clean/Create dist directory
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true });
    }
    fs.mkdirSync(distDir);
    fs.mkdirSync(path.join(distDir, 'js'));
    fs.mkdirSync(path.join(distDir, 'css'));

    // 2. Build JS
    console.log('Bundling JS...');
    await esbuild.build({
        entryPoints: ['js/app.js'],
        bundle: true,
        minify: true,
        sourcemap: true,
        target: ['es2020'],
        outfile: 'dist/js/app.bundle.js',
    });

    // 3. Build CSS
    console.log('Bundling CSS...');
    const originalHtml = fs.readFileSync('index.html', 'utf8');
    const cssMatch = originalHtml.match(/href="(css\/.*?\.css)"/g);
    const cssFiles = cssMatch ? cssMatch.map(m => m.match(/href="(css\/.*?\.css)"/)[1]) : ['css/base.css'];
    
    // To bundle multiple CSS files into one, we create a temporary entry point
    const tempCssEntry = path.join(__dirname, 'temp_bundle.css');
    const cssContent = cssFiles.map(f => `@import "${f}";`).join('\n');
    fs.writeFileSync(tempCssEntry, cssContent);

    try {
        await esbuild.build({
            entryPoints: [tempCssEntry],
            bundle: true,
            minify: true,
            outfile: 'dist/css/style.bundle.css',
            loader: { '.png': 'dataurl', '.svg': 'dataurl' } // Handle assets if needed
        });
    } finally {
        if (fs.existsSync(tempCssEntry)) fs.unlinkSync(tempCssEntry);
    }

    // 4. Copy static assets
    console.log('Copying assets...');
    const assets = [
        'index.html',
        'manifest.json',
        'favicon.svg',
        'favicon-dev.svg',
        'icon512x512.png',
        'og-image.png',
        'sw.js',
        'images',
        'templates'
    ];

    for (const asset of assets) {
        if (fs.existsSync(asset)) {
            const stats = fs.statSync(asset);
            if (stats.isDirectory()) {
                fs.cpSync(asset, path.join(distDir, asset), { recursive: true });
            } else {
                fs.copyFileSync(asset, path.join(distDir, asset));
            }
        }
    }

    // 5. Post-process index.html in dist
    console.log('Optimizing index.html...');
    let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');

    // Remove multiple CSS links and replace with one
    const cssRegex = /<link rel="stylesheet" href="css\/.*?" \/>/g;
    html = html.replace(cssRegex, '');
    html = html.replace('<!-- ═══════════════════ STYLESHEETS ═══════════════════ -->', 
        '<!-- ═══════════════════ STYLESHEETS ═══════════════════ -->\n  <link rel="stylesheet" href="css/style.bundle.css" />');

    // Remove the module script tags and replace with bundle
    // We target the main app.js and giphy.js since they are now bundled into app.bundle.js
    const scriptRegex = /<script type="module" src="js\/.*?"(><\/script>)?/g;
    html = html.replace(scriptRegex, '');
    html = html.replace('<!-- Application entry point -->', 
        '<!-- Application entry point -->\n  <script type="module" src="js/app.bundle.js"></script>');

    fs.writeFileSync(path.join(distDir, 'index.html'), html);

    console.log('Build complete! Output in /dist');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});

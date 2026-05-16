const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

async function build() {
    const distDir = path.join(__dirname, 'dist');
    const buildId = Date.now().toString().slice(-8); // Short unique ID

    // 1. Clean/Create dist directory
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true });
    }
    fs.mkdirSync(distDir);
    fs.mkdirSync(path.join(distDir, 'js'));
    fs.mkdirSync(path.join(distDir, 'css'));

    // 2. Build JS
    console.log(`Bundling JS [${buildId}]...`);
    const jsFile = `app.${buildId}.js`;
    await esbuild.build({
        entryPoints: ['js/app.js'],
        bundle: true,
        minify: true,
        sourcemap: true,
        target: ['es2020'],
        outfile: path.join(distDir, 'js', jsFile),
        drop: process.env.GITHUB_ACTIONS === 'true' ? ['console', 'debugger'] : [],
    });

    // 3. Build CSS
    console.log(`Bundling CSS [${buildId}]...`);
    const cssFile = `style.${buildId}.css`;
    const originalHtml = fs.readFileSync('index.html', 'utf8');
    const cssMatch = originalHtml.match(/href="(css\/.*?\.css)"/g);
    const cssFiles = cssMatch ? cssMatch.map(m => m.match(/href="(css\/.*?\.css)"/)[1]) : ['css/base.css'];

    const tempCssEntry = path.join(__dirname, 'temp_bundle.css');
    const cssContent = cssFiles.map(f => `@import "${f}";`).join('\n');
    fs.writeFileSync(tempCssEntry, cssContent);

    try {
        await esbuild.build({
            entryPoints: [tempCssEntry],
            bundle: true,
            minify: true,
            outfile: path.join(distDir, 'css', cssFile),
        });
    } finally {
        if (fs.existsSync(tempCssEntry)) fs.unlinkSync(tempCssEntry);
    }

    // 4. Copy static assets
    console.log('Copying assets...');
    const assets = [
        'manifest.json',
        'favicon.svg',
        'favicon-dev.svg',
        'icon512x512.png',
        'og-image.png',
        'sw.js',
        'images',
        'templates',
        'privacy.html',
        'csam-2026-03-22.html',
        'csam.html',
        'CNAME'
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

    // 5. Post-process and Minify HTML files
    console.log('Optimizing and Minifying HTML files...');
    const htmlFiles = [
        { path: 'index.html', hasJs: true },
        { path: 'privacy.html', hasJs: false },
        { path: 'csam-2026-03-22.html', hasJs: false },
        { path: 'csam.html', hasJs: false }
    ];

    for (const file of htmlFiles) {
        if (!fs.existsSync(file.path)) continue;
        
        console.log(`  Processing ${file.path}...`);
        let html = fs.readFileSync(file.path, 'utf8');

        // Remove multiple CSS links and replace with one
        const cssRegex = /<link rel="stylesheet" href="css\/.*?" \/>/g;
        html = html.replace(cssRegex, '');
        
        const cssLink = `<link rel="stylesheet" href="css/${cssFile}" />`;
        if (html.includes('<!-- ═══════════════════ STYLESHEETS ═══════════════════ -->')) {
            html = html.replace('<!-- ═══════════════════ STYLESHEETS ═══════════════════ -->', 
                `<!-- ═══════════════════ STYLESHEETS ═══════════════════ -->\n  ${cssLink}`);
        } else {
            // Insert before the first <style> tag or before </head>
            if (html.includes('<style>')) {
                html = html.replace('<style>', `${cssLink}\n    <style>`);
            } else {
                html = html.replace('</head>', `    ${cssLink}\n</head>`);
            }
        }

        // Remove the module script tags and replace with bundle if needed
        if (file.hasJs) {
            const scriptRegex = /<script type="module" src="js\/.*?"(><\/script>)?/g;
            html = html.replace(scriptRegex, '');
            const jsLink = `<script type="module" src="js/${jsFile}"></script>`;
            if (html.includes('<!-- Application entry point -->')) {
                html = html.replace('<!-- Application entry point -->', 
                    `<!-- Application entry point -->\n  ${jsLink}`);
            } else {
                html = html.replace('</body>', `  ${jsLink}\n</body>`);
            }
        }

        // Actual minification
        const minifiedHtml = await minify(html, {
            removeAttributeQuotes: false,
            collapseWhitespace: true,
            removeComments: true,
            minifyJS: true,
            minifyCSS: true,
            processConditionalComments: true,
            removeEmptyAttributes: true,
            removeRedundantAttributes: true,
            trimCustomFragments: true
        });

        fs.writeFileSync(path.join(distDir, file.path), minifiedHtml);
    }

    console.log('Build complete! Output in /dist');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});

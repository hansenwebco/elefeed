// Quick test verification script
// Checks if production HTML has all required elements

const fs = require('fs');
const path = require('path');

// Read production HTML
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

console.log(`✓ Production HTML loaded (${html.length} bytes)\n`);

// Required element IDs that tests check for
const requiredElements = {
  'screens': ['splash-screen', 'login-screen', 'callback-screen', 'app-screen'],
  'drawers': ['profile-drawer', 'thread-drawer', 'notif-drawer', 'compose-drawer', 'settings-drawer', 'search-drawer'],
  'classes': {
    'profile-drawer': 'profile-drawer',
    'compose-drawer': 'compose-drawer',
    'search-drawer': 'search-drawer'
  }
};

let allPass = true;

// Check screens
console.log('Screens:');
requiredElements.screens.forEach(screen => {
  const exists = html.includes(`id="${screen}"`);
  console.log(`  ${exists ? '✓' : '✗'} id="${screen}"`);
  if (!exists) allPass = false;
});

console.log('\nDrawers:');
requiredElements.drawers.forEach(drawer => {
  const exists = html.includes(`id="${drawer}"`);
  console.log(`  ${exists ? '✓' : '✗'} id="${drawer}"`);
  if (!exists) allPass = false;
});

console.log('\nClass attributes:');
Object.entries(requiredElements.classes).forEach(([elem, className]) => {
  const exists = html.includes(`class="${className}"`) || html.includes(`class="${className} `) || html.includes(` ${className}"`);
  console.log(`  ${exists ? '✓' : '✗'} class="${className}" in ${elem}`);
  if (!exists) allPass = false;
});

console.log(`\n${allPass ? '✓ All production HTML elements present' : '✗ Some elements missing'}`);

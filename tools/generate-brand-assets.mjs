import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (await fs.readFile(path.join(root, 'src/assets/brand/chat-dual-logo.svg'), 'utf8')).replace(/^\uFEFF/, '');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const logo = 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64');
  async function render(file, width, height, mode) {
    const png = await page.evaluate(async ({ logo, width, height, mode }) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const image = new Image(); image.src = logo; await image.decode();
      if (mode === 'splash') {
        ctx.fillStyle = '#f7f8fc'; ctx.fillRect(0, 0, width, height);
        const size = Math.round(Math.min(width, height) * .25);
        ctx.drawImage(image, (width - size) / 2, (height - size) / 2 - size * .25, size, size);
        ctx.fillStyle = '#25263c'; ctx.textAlign = 'center'; ctx.font = `600 ${Math.round(size * .22)}px Arial`;
        ctx.fillText('Chat Dual', width / 2, height / 2 + size * .5);
      } else if (mode === 'native-splash') {
        const size = Math.round(width * .6);
        ctx.drawImage(image, (width - size) / 2, (height - size) / 2, size, size);
      } else {
        if (mode === 'round') { ctx.beginPath(); ctx.arc(width/2, height/2, width/2, 0, Math.PI*2); ctx.clip(); }
        ctx.drawImage(image, 0, 0, width, height);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, { logo, width, height, mode });
    const destination = path.join(root, file); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(png, 'base64'));
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    await render(`android/app/src/main/res/mipmap-${density}/ic_launcher.png`, size, size, 'icon');
    await render(`android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`, size, size, 'round');
  }
  await render('src/assets/brand/chat-dual-logo.png', 512, 512, 'icon');
  await render('src/assets/icon/favicon.png', 64, 64, 'icon');
  await render('android/app/src/main/res/drawable-nodpi/chat_dual_splash.png', 864, 864, 'native-splash');
  const resources = path.join(root, 'android/app/src/main/res');
  for (const directory of await fs.readdir(resources)) {
    if (!directory.startsWith('drawable-port-') && !directory.startsWith('drawable-land-')) continue;
    const file = path.join(resources, directory, 'splash.png');
    const current = await fs.readFile(file); const width = current.readUInt32BE(16), height = current.readUInt32BE(20);
    await render(`android/app/src/main/res/${directory}/splash.png`, width, height, 'splash');
  }
  await render('android/app/src/main/res/drawable/splash.png', 480, 800, 'splash');
  await render('resources/splash-preview.png', 480, 800, 'splash');
  console.log('Chat Dual: iconos, favicon y splash generados.');
} finally { await browser.close(); }

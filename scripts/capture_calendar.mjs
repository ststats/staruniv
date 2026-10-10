import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePage } from './capture_page.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
    try {
        let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
});
try {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(process.env.CAPTURE_PORT || 8791), '127.0.0.1', resolve);
    });
    const size = await capturePage({
        url: `http://127.0.0.1:${server.address().port}/schedule/?capture=calendar`,
        output: path.join(root, 'data/calendar.png'), width: 804, height: 2000, calendar: true,
    });
    console.log(`달력 캡처 완료 (${size.width}x${size.height})`);
} finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

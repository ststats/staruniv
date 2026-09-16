const fs = require("fs"),
  path = require("path"),
  http = require("http"),
  puppeteer = require("puppeteer");
const server = http.createServer((req, res) => {
  let p = path.join(
    process.cwd(),
    "docs",
    decodeURIComponent(req.url.split("?")[0]),
  );
  if (fs.existsSync(p) && fs.statSync(p).isDirectory())
    p = path.join(p, "index.html");
  if (!fs.existsSync(p)) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    "Content-Type",
    {
      ".css": "text/css",
      ".js": "text/javascript",
      ".html": "text/html",
      ".json": "application/json",
    }[path.extname(p)] || "application/octet-stream",
  );
  res.end(fs.readFileSync(p));
});
(async () => {
  await new Promise((r) => server.listen(8796, r));
  const b = await puppeteer.launch({ headless: true });
  const all = [];
  try {
    for (const route of [
      "",
      "schedule/",
      "members/",
      "records/",
      "stats/",
      "tier/",
      "tools/",
      "admin.html",
      "multiview.html",
    ]) {
      const p = await b.newPage();
      await p.setViewport({ width: 1280, height: 900 });
      await p.setRequestInterception(true);
      p.on("request", (r) =>
        r.url().startsWith("http://localhost:8796/") ||
        ["stylesheet", "font"].includes(r.resourceType())
          ? r.continue()
          : r.abort(),
      );
      await p.goto("http://localhost:8796/" + route, {
        waitUntil: "networkidle2",
      });
      await p.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.dataset.bsTheme = "dark";
        document
          .querySelectorAll('[id^="view-"]')
          .forEach((e) => e.classList.remove("d-none"));
      });
      await p.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
      const result = await p.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
        const lum = (c) =>
          c
            .slice(0, 3)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((v, x, i) => v + x * [0.2126, 0.7152, 0.0722][i], 0);
        return Array.from(document.querySelectorAll("body *"))
          .filter(
            (e) =>
              e.getBoundingClientRect().height &&
              Array.from(e.childNodes).some(
                (n) => n.nodeType === 3 && n.textContent.trim(),
              ),
          )
          .map((e) => {
            const s = getComputedStyle(e);
            let bg = [255, 255, 255];
            for (let a = e; a; a = a.parentElement) {
              const c = rgb(getComputedStyle(a).backgroundColor);
              if (c.length >= 3 && (c[3] ?? 1) > 0.8) {
                bg = c;
                break;
              }
            }
            const fg = rgb(s.color),
              l1 = lum(fg),
              l2 = lum(bg),
              ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            return {
              selector: e.tagName + "." + e.className,
              text: e.textContent.trim().slice(0, 40),
              fg: s.color,
              bg: JSON.stringify(bg),
              ratio: +ratio.toFixed(2),
            };
          })
          .filter((x) => x.ratio < 3);
      });
      all.push({ route, issues: result });
      console.log(
        route || "home",
        JSON.stringify([
          ...new Map(result.map((x) => [x.selector, x])).values(),
        ]),
      );
      await p.close();
    }
  } finally {
    await b.close();
    server.close();
  }
  fs.mkdirSync("build/dark-audit", { recursive: true });
  fs.writeFileSync(
    "build/dark-audit/results.json",
    JSON.stringify(all, null, 2),
  );
})();

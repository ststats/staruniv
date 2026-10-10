// 사이트 CSS를 안 부르는 단독 페이지(webp-maker·404)의 토큰 복사본이 01-tokens.css와 같은지 본다.
// 그 페이지에만 있는 토큰은 견주지 않는다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const vars = block =>
    Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
// var(--x)만으로 된 값은 같은 블록(다크는 라이트까지)에서 끝까지 풀어 견준다
const resolve = (table, v) => {
    for (let i = 0; i < 10; i++) {
        const m = v.match(/^var\((--[\w-]+)\)$/);
        if (!m || !(m[1] in table)) break;
        v = table[m[1]];
    }
    return v.replace(/\s+/g, ' ');
};

const site = read('templates/assets/style/01-tokens.css');
// 다크 블록 머리는 따옴표 모양과 상관없이 찾는다(Prettier가 바꾼다)
const DARK_HEAD = /html\[data-theme=['"]dark['"]\] \{/;
const darkAt = site.search(new RegExp('\\n' + DARK_HEAD.source));
const siteLight = vars(site.slice(0, darkAt));
const siteDark = { ...siteLight, ...vars(site.slice(darkAt, site.indexOf('\n}', darkAt))) };

for (const [label, file] of [
    ['움짤생성기', 'templates/standalone/webp-maker.html'],
    ['404', 'templates/static/404.html'],
]) {
    const page = read(file);
    const rootAt = page.indexOf(':root {');
    const darkAt2 = rootAt + page.slice(rootAt).search(DARK_HEAD);
    const light = vars(page.slice(rootAt, darkAt2));
    const dark = { ...light, ...vars(page.slice(darkAt2, page.indexOf('}', darkAt2))) };
    for (const [name, mine, theirs] of [
        ['라이트', light, siteLight],
        ['다크', dark, siteDark],
    ]) {
        test(`${label} 토큰 복사본이 사이트 토큰과 같다(${name})`, () => {
            const diff = Object.keys(mine)
                .filter(k => k in theirs)
                .filter(k => resolve(mine, mine[k]) !== resolve(theirs, theirs[k]))
                .map(k => `${k}: ${label} ${resolve(mine, mine[k])} / 사이트 ${resolve(theirs, theirs[k])}`);
            assert.deepStrictEqual(diff, [], `${file} :root 복사본을 01-tokens.css 값으로 맞출 것`);
        });
    }
}

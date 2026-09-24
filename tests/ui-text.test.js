// 사이트 문구는 끝에 마침표(.)·말줄임표(... …)를 붙이지 않는다.
// templates/ 안 JS·HTML의 한글 문자열과 태그 사이 글자를 본다(주석·console 줄은 제외).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'templates');

function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(f => {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) return files(p);
        return /\.(js|html)$/.test(f.name) ? [p] : [];
    });
}

test('화면 문구 끝에 마침표·말줄임표가 없다', () => {
    const quoted = /(['"`])[^'"`\n]*[가-힣][^'"`\n]*?(?:\.{1,3}|…)\1/;
    const tagText = /[가-힣)](?:\.{1,3}|…)<\//;
    const bad = [];
    for (const f of files(ROOT)) {
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
            const s = line.trim();
            if (/^(\/\/|\/\*|\*|#|\{#)/.test(s) || line.includes('console.')) return;
            if (quoted.test(line) || tagText.test(line)) {
                bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
            }
        });
    }
    assert.deepStrictEqual(bad, [], '문구 끝의 . / ... / … 를 지울 것');
});

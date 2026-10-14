// 코드 조각을 공백·줄바꿈과 상관없이 찾는 정규식으로 만든다(포맷터가 바꿔도 맞게).
// 따옴표 안 글자와 낱말 사이 띄어쓰기는 그대로 본다.
function code(snippet) {
    const esc = c => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const word = c => /[\w$가-힣]/.test(c);
    let out = '',
        quote = '';
    for (let i = 0; i < snippet.length; i++) {
        const c = snippet[i],
            next = snippet[i + 1];
        if (quote) {
            out += esc(c);
            if (c === quote && snippet[i - 1] !== '\\') quote = '';
        } else if (c === ' ') {
            out += '\\s+';
            continue;
        } else {
            out += esc(c);
            if (c === "'" || c === '"' || c === '`') quote = c;
        }
        if (!quote && next !== undefined && next !== ' ' && !(word(c) && word(next))) out += '\\s*';
    }
    return new RegExp(out);
}
module.exports = { code };

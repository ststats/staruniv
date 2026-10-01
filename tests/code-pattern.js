// 코드 조각을 띄어쓰기·줄바꿈과 상관없이 찾는 정규식으로 만든다. 포맷터(.prettierrc.json)가 공백·줄바꿈을
// 바꿔도 같은 코드면 맞는다. 따옴표 안 글자는 그대로 비교하고, 낱말 글자끼리는 띄어 쓴 그대로 본다.
function code(snippet) {
    const esc = c => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const word = c => /[\w$가-힣]/.test(c);
    let out = '', quote = '';
    for (let i = 0; i < snippet.length; i++) {
        const c = snippet[i], next = snippet[i + 1];
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

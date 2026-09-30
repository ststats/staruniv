// 멤버 ↔ 티어표 연동(staruniv.sql 9번): 생년월일·성별은 티어표가 원본이라 지워도 멤버 쪽에 남지 않아야 한다.
// 실제 동작은 임시 PostgreSQL로 확인했고, 여기서는 규칙이 되돌아가지 않았는지만 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/staruniv.sql'), 'utf8').replace(/\r\n/g, '\n');

test('이어진 뒤에는 티어표의 빈 값도 그대로 따른다', () => {
    assert.match(sql, /new\.birth_date := t\.birth_date;/);
    assert.match(sql, /new\.gender := nullif\(btrim\(t\.gender\), ''\);/);
});

test('멤버 쪽 입력은 티어표로 올리고, 지운 값을 되살리는 옛 일괄 복사는 없다', () => {
    assert.match(sql, /create trigger members_push_to_tier after insert or update of birth_date, gender, tier_member_id on public\.members/);
    assert.doesNotMatch(sql, /set birth_date = coalesce\(t\.birth_date, m\.birth_date\)/);
});

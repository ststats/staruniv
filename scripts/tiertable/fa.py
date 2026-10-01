"""FA 명단 글."""

import re


FA_TIER = {'갓티어': '갓', '킹티어': '킹', '잭티어': '잭', '조커요': '조커', '조커티어': '조커',
           '스페읻': '스페이드', '스페이드': '스페이드', 'BABY': '베이비', '베이비': '베이비'}


FA_TIERS = {'갓', '킹', '잭', '조커', '스페이드', '베이비'} | {str(n) for n in range(9)}


def read_fa_text(text: str):
    out, tier, race = [], None, None
    for line in text.splitlines():
        line = line.strip()
        if not line or 'FA 인원' in line:
            continue
        # 명단 줄은 '티어｜ T …' 또는 이어지는 'P …' 줄뿐이다. 글의 다른 문장은 이름으로 읽지 않는다
        if not ('｜' in line or '|' in line or line.split()[0] in ('T', 'Z', 'P')):
            continue
        if '｜' in line or '|' in line:
            head, line = re.split(r'[｜|]', line, maxsplit=1)
            head = head.strip()
            tier = FA_TIER.get(head, re.sub(r'티어$', '', head).strip())
            if tier not in FA_TIERS:   # '댓글 환영 | 공지' 같은 다른 문장
                tier = race = None
                continue
            race = None
        for tok in line.split():
            if tok in ('T', 'Z', 'P'):
                race = {'T': '테란', 'Z': '저그', 'P': '프로토스'}[tok]
            elif tier and race:
                out.append({'tier': tier, 'race': race, 'nickname': tok})
    return out

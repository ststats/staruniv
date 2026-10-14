"""DB와 맞추기: 구역의 대학을 정하고 카드를 선수와 짝지어 변동·확인할 것을 만든다."""

import collections
import difflib
import re


def suggest_candidates(card, team, candidates, n=3):
    """모르는 카드와 이름이 비슷한 ELO 대기 명단 선수(같은 대학이면 가산)."""
    ocr = card.get('nickname_ocr') or ''
    if not ocr or not candidates:
        return []
    scored = []
    for c in candidates:
        sim = similarity(ocr, str(c.get('nickname') or ''))
        if c.get('affiliation') and c['affiliation'] == team:
            sim += 0.15
        if sim >= 0.5:
            scored.append((sim, c))
    scored.sort(key=lambda x: -x[0])
    return [{'elo_id': c['elo_id'], 'nickname': c.get('nickname') or '', 'soop_id': c.get('soop_id') or '',
             'tier': c.get('tier') or '', 'race': c.get('race') or '', 'affiliation': c.get('affiliation') or '',
             'gender': c.get('gender') or '', 'score': round(sim, 2)} for sim, c in scored[:n]]


def similarity(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


NO_TEAM = ('휴면', 'FA', None, '')
TITLE_SAME = 0.5    # OCR 오타(뉴켓슬→뉴캣슬)는 0.67, 다른 대학끼리는 0.4 이하


def title_guess(texts):
    return next((t for t in texts if re.search('[가-힣]', t)), texts[-1] if texts else '')


def decide_teams(sections, by_team):
    """구역마다 [(대학, 새 대학 여부)]. 머리 글씨가 우선이고, 같은 대학이 두 구역에 걸리면 더 비슷한 쪽만 인정한다."""
    teams = [t for t in by_team if t not in NO_TEAM]
    best = []
    for sec in sections:
        texts = sec.get('title_ocr') or []
        scored = sorted(((max(similarity(x, t) for x in texts), t) for t in teams), reverse=True) if texts and teams else []
        best.append(scored)
    taken, out = {}, [None] * len(sections)
    order = sorted(range(len(sections)), key=lambda k: -(best[k][0][0] if best[k] else 0))
    for k in order:
        pick = next(((sc, t) for sc, t in best[k] if sc >= TITLE_SAME and t not in taken), None)
        if pick:
            taken[pick[1]] = k
            out[k] = (pick[1], False)
    for k, sec in enumerate(sections):
        if out[k] or not sec['cards']:
            continue
        texts = sec.get('title_ocr') or []
        if texts:
            out[k] = (title_guess(texts), True)
            continue
        def team_score(team):
            names = [r['nickname'] for r in by_team[team]]
            return sum(max((similarity(c['nickname_ocr'], n) for n in names), default=0) for c in sec['cards'])
        left = [t for t in teams if t not in taken]
        team = max(left, key=team_score) if left else '(이름 모름)'
        taken[team] = k
        out[k] = (team, team not in by_team)
    return [o or (None, False) for o in out]


def match_sections(sections, db):
    by_team = collections.defaultdict(list)
    for r in db:
        by_team[r['affiliation']].append(r)
    results = []
    for sec, (team, is_new) in zip(sections, decide_teams(sections, by_team)):
        cards = sec['cards']
        pool = [] if is_new else list(by_team.get(team, []))
        used_c, used_r, match = set(), set(), {}
        # 사진으로 아는 선수는 소속이 바뀌었어도 바로 찾는다
        for i, c in enumerate(cards):
            known = c.get('known')
            if not known:
                continue
            r = next((x for x in db if known.get('soop_id') and x.get('soop_id') == known['soop_id']), None) \
                or next((x for x in db if x['nickname'] == known['nickname']), None)
            if r is None:
                continue
            used_c.add(i)
            match[i] = (r, 1.0)
            for j, p in enumerate(pool):
                if p is r:
                    used_r.add(j)
        pairs = sorted(((similarity(c['nickname_ocr'], r['nickname']) + (0.15 if c['tier'] == str(r['tier']) else 0)
                         + (0.1 if c['race'] == r['race'] else 0), i, j)
                        for i, c in enumerate(cards) for j, r in enumerate(pool)), reverse=True)
        for score, i, j in pairs:
            if i in used_c or j in used_r or score < 0.45:
                continue
            used_c.add(i); used_r.add(j); match[i] = (pool[j], score)
        results.append({'team': team, 'new_team': is_new, 'title_ocr': sec.get('title_ocr') or [], 'cards': cards,
                        'match': match, 'missing': [pool[j] for j in range(len(pool)) if j not in used_r]})
    return results


# 두 번째 후보와의 여유가 이보다 작으면 '확인 필요'.
# 실측: 틀리게 읽힌 것은 모두 0.027 이하, 안 바뀐 카드는 모두 0.076 이상.
UNSURE_MARGIN = 0.03


def compare(sections, fa, db, candidates=None, off_board=()):
    """카드·FA 명단을 DB와 비교해 changes(반영할 변동)와 review(사람이 고를 것)를 만든다.
    off_board 대학 선수는 표에 안 나와도 FA·휴면으로 바꾸지 않는다."""
    changes, review, missing, matches = [], [], [], []
    matched_ids, unknown_in = set(), collections.Counter()
    secs = match_sections(sections, db)
    for si, sec in enumerate(secs):
        team = sec['team']
        if sec['new_team']:
            prev = collections.Counter(hit[0]['affiliation'] for hit in sec['match'].values())
            review.append({'type': '새 대학', 'section': si, 'team': team, 'title_ocr': sec['title_ocr'],
                           'cards': len(sec['cards']), 'prev_affiliation': prev.most_common(3)})
        for i, card in enumerate(sec['cards']):
            hit = sec['match'].get(i)
            if not hit:
                best = max(db, key=lambda r: similarity(card['nickname_ocr'], r['nickname']), default=None)
                if best is not None and similarity(card['nickname_ocr'], best['nickname']) >= 0.75:
                    hit = (best, 0)
                else:
                    unknown_in[team] += 1
                    review.append({'type': '신규 또는 인식 실패', 'team': team, 'ref': [si, i], 'card': brief_card(card),
                                   'suggest': suggest_candidates(card, team, candidates or [])})
                    continue
            r = hit[0]
            matched_ids.add(id(r))
            matches.append({'ref': [si, i], 'id': r.get('id'), 'soop_id': r.get('soop_id'), 'nickname': r['nickname'],
                            'db_tier': str(r['tier']), 'db_race': r['race'], 'card_tier': card['tier'],
                            'card_race': card['race'], 'by_photo': bool(card.get('known')), 'team': team})
            diff = {}
            if r['affiliation'] != team:
                diff['affiliation'] = [r['affiliation'], team]
            notes = []
            for kind, label, db_value in (('tier', '티어', str(r['tier'])), ('race', '종족', r['race'])):
                value, read = card[kind], card.get(kind + '_read') or {}
                # 종족은 빈 값('')도 읽은 값이다(종족미정). None만 못 읽은 것
                unread = value is None or (value == '' and kind != 'race')
                if not unread and (db_value or '') != value:
                    diff[kind] = [r[kind], value]
                if unread:
                    # 조용히 넘기면 변동을 놓친다
                    diff[kind] = [r[kind], None]
                    notes.append(f'{label} 글씨를 읽지 못했습니다. 카드를 보고 고르세요')
                elif read.get('margin') is not None and read['margin'] < UNSURE_MARGIN:
                    # 5·6·8처럼 헷갈리는 글씨면 안 바뀐 것으로 읽혔어도 확인하게 올린다
                    diff.setdefault(kind, [r[kind], value])
                    notes.append(f"{label} 글씨가 {value}·{read.get('alt')} 중 어느 쪽인지 헷갈립니다")
                elif read.get('ocr') and kind in diff:
                    notes.append(f'처음 보는 {label} 글씨라 글자 인식으로 읽었습니다')
            if diff:
                change = {'id': r.get('id'), 'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': team,
                          'diff': diff, 'ocr': card['nickname_ocr'], 'ref': [si, i]}
                if notes:
                    change['uncertain'] = ' / '.join(notes)
                changes.append(change)
            # 닉네임 변경은 OCR 오류일 수 있어 따로 두고 기본 체크 해제한다.
            ocr_nick = (card.get('nickname_ocr') or '').strip()
            if ocr_nick and not card.get('name_unchanged') and ''.join(ocr_nick.split()) != ''.join(str(r['nickname']).split()):
                changes.append({'id': r.get('id'), 'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': team,
                                'diff': {'nickname': [r['nickname'], ocr_nick]}, 'ocr': ocr_nick, 'ref': [si, i],
                                'uncertain': '카드 글씨로 읽은 닉네임입니다. 카드와 같으면 체크하세요(틀린 글자는 고쳐서)'})
        missing += [(team, r) for r in sec['missing']]

    # 한 선수가 여러 카드에 맞으면 변동·학습에서 빼되, 표에 있었던 것으로 쳐 휴면 처리를 막는다.
    by_id = collections.defaultdict(list)
    for match in matches:
        by_id[match['id']].append(match)
    duplicates = {pid for pid, hits in by_id.items() if len(hits) > 1}
    for pid in sorted(duplicates):
        hits = by_id[pid]
        review.append({'type': '중복 인식', 'id': pid, 'nickname': hits[0]['nickname'],
                       'cards': [{'ref': hit['ref'], 'team': hit['team'],
                                  'card': brief_card(sections[hit['ref'][0]]['cards'][hit['ref'][1]])}
                                 for hit in hits]})
    changes = [change for change in changes if change['id'] not in duplicates]
    matches = [match for match in matches if match['id'] not in duplicates]

    # 표에서 없어진 대학. 새 대학 선수 대부분이 그 출신이면 이름이 바뀐 것일 수 있다
    shown = {sec['team'] for sec in secs}
    kept_teams = set(off_board) - shown
    gone_teams = sorted({r['affiliation'] for r in db if r['affiliation'] not in NO_TEAM} - shown - kept_teams)
    for item in review:
        if item['type'] == '새 대학' and item['prev_affiliation']:
            top, n = item['prev_affiliation'][0]
            if top in gone_teams and n * 2 > item['cards']:
                item['renamed_from'] = top
    for team in gone_teams:
        review.append({'type': '표에서 없어진 대학', 'team': team,
                       'members': sum(1 for r in db if r['affiliation'] == team)})
        missing += [(team, r) for r in db if r['affiliation'] == team]

    fa_seen = set()
    for f in fa:
        exact = [r for r in db if r['nickname'] == f['nickname']]
        r = next((x for x in exact if x['affiliation'] == 'FA'), exact[0] if exact else None)
        if r is None:
            review.append({'type': 'FA 명단에만 있음(신규 또는 닉네임 변경)', **f})
            continue
        fa_seen.add(id(r))
        if id(r) in matched_ids:   # 표와 FA 명단 둘 다 있으면 표를 따른다
            review.append({'type': '표와 FA 명단에 둘 다 있음', 'id': r.get('id'), 'nickname': r['nickname']})
            continue
        diff = {}
        if r['affiliation'] in kept_teams:
            # off_board 대학 선수는 FA 명단에 있어도 소속을 지킨다
            review.append({'type': '현황판에 없는 대학 소속(소속 유지)', 'id': r.get('id'), 'nickname': r['nickname'],
                           'team': r['affiliation']})
        elif r['affiliation'] != 'FA':
            diff['affiliation'] = [r['affiliation'], 'FA']
        if str(r['tier']) != f['tier']:
            diff['tier'] = [r['tier'], f['tier']]
        if r['race'] != f['race']:
            diff['race'] = [r['race'], f['race']]
        if diff:
            changes.append({'id': r.get('id'), 'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': 'FA', 'diff': diff})

    # 표에도 FA 명단에도 없으면 휴면. FA 명단 글이 없으면 확인으로 둔다.
    gone = [(team, r) for team, r in missing if id(r) not in matched_ids and id(r) not in fa_seen]
    if fa:
        gone += [('FA', r) for r in db if r['affiliation'] == 'FA' and id(r) not in fa_seen and id(r) not in matched_ids]
    seen = set()
    for team, r in gone:
        if id(r) in seen:
            continue
        seen.add(id(r))
        if not fa:
            review.append({'type': '표에서 빠짐', 'team': team, 'id': r.get('id'), 'nickname': r['nickname'], 'tier': r['tier']})
            continue
        change = {'id': r.get('id'), 'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': '휴면',
                  'diff': {'affiliation': [r['affiliation'], '휴면']}, 'reason': '표·FA 명단에 없음'}
        if unknown_in.get(team):
            change['uncertain'] = f'{team}에 못 알아본 카드 {unknown_in[team]}장'
        changes.append(change)
    return {'changes': changes, 'review': review, 'matches': matches}


def brief_card(card):
    """관리자 화면 표시용 카드 요약."""
    return {k: card.get(k) for k in ('row', 'col', 'x', 'y', 'side', 'tier', 'race', 'role', 'nickname_ocr')}

"""DB와 맞추기: 구역의 대학을 정하고 카드를 선수와 짝지어 변동·확인할 것을 만든다."""

import collections
import difflib
import re


def suggest_candidates(card, team, candidates, n=3):
    """모르는 카드와 이름이 비슷한 ELO 대기 명단 선수(같은 대학이면 가산). 고르면 ELO ID까지 넣어 추가한다."""
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
TITLE_SAME = 0.5    # 머리 글씨와 기존 대학 이름이 이만큼 비슷하면 그 대학(뉴켓슬→뉴캣슬 0.67, 다른 대학끼리는 0.4 이하)


def title_guess(texts):
    """새 대학 이름으로 보여 줄 글씨: 한글이 있으면 한글 전용 결과, 아니면 한영 결과."""
    return next((t for t in texts if re.search('[가-힣]', t)), texts[-1] if texts else '')


def decide_teams(sections, by_team):
    """구역마다 대학을 정한다. 머리의 대학 이름 글씨가 우선이고, 기존 대학과 안 맞으면 새 대학으로 본다.
    같은 대학이 두 구역에 걸리면 더 비슷한 쪽만 그 대학이다. 반환: [(대학, 새 대학 여부)]"""
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
        # 머리 글씨를 못 읽음: 카드 닉네임과 가장 많이 맞는 (남은) 대학
        def team_score(team):
            names = [r['nickname'] for r in by_team[team]]
            return sum(max((similarity(c['nickname_ocr'], n) for n in names), default=0) for c in sec['cards'])
        left = [t for t in teams if t not in taken]
        team = max(left, key=team_score) if left else '(이름 모름)'
        taken[team] = k
        out[k] = (team, team not in by_team)
    return [o or (None, False) for o in out]


def match_sections(sections, db):
    """각 구역의 카드를 DB 선수와 맞추고, 구역의 대학을 정한다."""
    by_team = collections.defaultdict(list)
    for r in db:
        by_team[r['affiliation']].append(r)
    results = []
    for sec, (team, is_new) in zip(sections, decide_teams(sections, by_team)):
        cards = sec['cards']
        pool = [] if is_new else list(by_team.get(team, []))
        used_c, used_r, match = set(), set(), {}
        # 1) 사진으로 아는 선수: 소속이 바뀌었어도(다른 대학·FA·휴면) 바로 찾는다
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
        # 2) 나머지는 이름이 비슷한 순으로 짝을 짓는다(한 DB 선수는 한 카드에만)
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


# 두 번째 후보와의 여유가 이보다 작으면 '확인 필요'. 기억 글씨 201개로 티어가 바뀐 경우 2,894가지를
# 만들어 잰 값(2026-09-28): 틀리게 읽힌 105건은 모두 0.027 이하, 안 바뀐 카드 219장은 모두 0.076 이상이라
# 0.03이면 틀린 것은 다 잡고 안 바뀐 카드는 하나도 걸리지 않는다(맞게 읽힌 변동의 약 7%는 확인으로 올라간다).
UNSURE_MARGIN = 0.03


def compare(sections, fa, db, candidates=None, off_board=()):
    """카드·FA 명단을 DB와 비교한다. off_board: 현황판에 아직 없는 대학(teams.off_board) - 표에 안 나와도
    그 선수들을 FA·휴면으로 바꾸지 않는다(표에 그 대학이 나오면 평소대로 비교).
    changes: 반영할 변동(관리자 화면에서 기본 체크). uncertain이면 기본 체크 해제.
    review: 사람이 골라야 하는 것(새 얼굴·새 대학 등)."""
    changes, review, missing, matches = [], [], [], []
    matched_ids, unknown_in = set(), collections.Counter()
    secs = match_sections(sections, db)
    for si, sec in enumerate(secs):
        team = sec['team']
        if sec['new_team']:
            # 새 대학(또는 이름이 바뀐 대학): 카드 선수들이 원래 어디 소속이었는지 같이 보여 준다
            prev = collections.Counter(hit[0]['affiliation'] for hit in sec['match'].values())
            review.append({'type': '새 대학', 'section': si, 'team': team, 'title_ocr': sec['title_ocr'],
                           'cards': len(sec['cards']), 'prev_affiliation': prev.most_common(3)})
        for i, card in enumerate(sec['cards']):
            hit = sec['match'].get(i)
            if not hit:
                # 같은 대학에 없는 선수: DB 전체에서 찾는다(이적·신규·휴면 복귀)
                best = max(db, key=lambda r: similarity(card['nickname_ocr'], r['nickname']))
                if similarity(card['nickname_ocr'], best['nickname']) >= 0.75:
                    hit = (best, 0)
                else:
                    unknown_in[team] += 1
                    review.append({'type': '신규 또는 인식 실패', 'team': team, 'ref': [si, i], 'card': brief_card(card),
                                   'suggest': suggest_candidates(card, team, candidates or [])})
                    continue
            r = hit[0]
            matched_ids.add(id(r))
            # 이 카드를 이 선수로 본 짝(반영할 때 사진·글씨를 기억하는 데 쓴다)
            matches.append({'ref': [si, i], 'id': r.get('id'), 'soop_id': r.get('soop_id'), 'nickname': r['nickname'],
                            'db_tier': str(r['tier']), 'db_race': r['race'], 'card_tier': card['tier'],
                            'card_race': card['race'], 'by_photo': bool(card.get('known')), 'team': team})
            diff = {}
            if r['affiliation'] != team:
                diff['affiliation'] = [r['affiliation'], team]
            notes = []
            for kind, label, db_value in (('tier', '티어', str(r['tier'])), ('race', '종족', r['race'])):
                value, read = card[kind], card.get(kind + '_read') or {}
                if value and db_value != value:
                    diff[kind] = [r[kind], value]
                if not value:
                    # 못 읽은 카드를 조용히 넘기면 그 선수의 변동을 놓친다: 관리자가 카드를 보고 고르게 올린다
                    diff[kind] = [r[kind], None]
                    notes.append(f'{label} 글씨를 읽지 못했습니다. 카드를 보고 고르세요')
                elif read.get('margin') is not None and read['margin'] < UNSURE_MARGIN:
                    # 비슷한 글씨(5·6·8 등)와 거의 같은 거리: 안 바뀐 것으로 읽혔어도 확인하게 올린다
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
            # 닉네임 변경(예: 박쭈이 → 쭈이). 카드는 사진·비슷한 이름·티어로 같은 사람으로 맞췄지만 글씨가 다르다.
            # 글씨 인식이 틀렸을 수도 있어 따로 한 줄로 두고 기본은 체크 해제 - 카드 사진을 보고 고르게 한다.
            ocr_nick = (card.get('nickname_ocr') or '').strip()
            if ocr_nick and not card.get('name_unchanged') and ''.join(ocr_nick.split()) != ''.join(str(r['nickname']).split()):
                changes.append({'id': r.get('id'), 'nickname': r['nickname'], 'soop_id': r['soop_id'], 'team': team,
                                'diff': {'nickname': [r['nickname'], ocr_nick]}, 'ocr': ocr_nick, 'ref': [si, i],
                                'uncertain': '카드 글씨로 읽은 닉네임입니다. 카드와 같으면 체크하세요(틀린 글자는 고쳐서)'})
        missing += [(team, r) for r in sec['missing']]

    # 표에서 없어진 대학. 새 대학 선수 대부분이 그 대학 출신이면 이름이 바뀐 것일 수 있다고 알려 준다
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

    # FA 명단
    fa_seen = set()
    for f in fa:
        exact = [r for r in db if r['nickname'] == f['nickname']]
        r = next((x for x in exact if x['affiliation'] == 'FA'), exact[0] if exact else None)
        if r is None:
            review.append({'type': 'FA 명단에만 있음(신규 또는 닉네임 변경)', **f})
            continue
        fa_seen.add(id(r))
        if id(r) in matched_ids:   # 표에도 있고 FA 명단에도 있음: 표를 따른다
            review.append({'type': '표와 FA 명단에 둘 다 있음', 'id': r.get('id'), 'nickname': r['nickname']})
            continue
        diff = {}
        if r['affiliation'] in kept_teams:
            # 현황판에 아직 없는 대학 선수는 FA 명단에 남아 있어도 소속을 지킨다(티어·종족만 본다)
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

    # 표에도 FA 명단에도 없는 선수 → 휴면. FA 명단 글이 없으면 판단하지 않고 확인으로 둔다.
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
            # 같은 대학에 못 알아본 카드가 있으면 그 카드가 이 선수일 수 있다
            change['uncertain'] = f'{team}에 못 알아본 카드 {unknown_in[team]}장'
        changes.append(change)
    return {'changes': changes, 'review': review, 'matches': matches}


def brief_card(card):
    """결과에 싣는 카드 요약(관리자 화면 표시용). 사진·글씨 특징은 sections에 따로 있다."""
    return {k: card.get(k) for k in ('row', 'col', 'x', 'y', 'side', 'tier', 'race', 'role', 'nickname_ocr')}

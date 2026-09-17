"""영상 탭 데이터: 어드민이 등록한 유튜브 채널의 최신 영상을 RSS로 모아 docs/data/videos.json에 쌓는다.

[입력] docs/data/video_channels.json (어드민 '영상 관리'에서 편집)
    { "channels": [ { "url": "https://www.youtube.com/@handle", "name": "표시 이름(선택)" } ],
      "picks":    [ { "url": "https://youtu.be/...", "title": "(선택)", "note": "한 줄 설명", "addedAt": "YYYY-MM-DD" } ] }

[출력] docs/data/videos.json
    { "updatedAt": "...",
      "channels": { "<등록 url>": { "id": "UC...", "title", "name", "thumb", "url" } },
      "videos":   [ { "id", "channel": "<등록 url>", "title", "published", "views", "thumb", "short" } ],
      "picks":    [ { "id", "title", "note", "addedAt", "author", "thumb", "short" } ] }

[왜 RSS인가] API 키가 필요 없다. 대신 채널마다 최신 15개만 준다. 그래서 받은 영상을 이 파일에
계속 쌓아 두고(보관), 피드에 남아 있는 동안은 조회수를 갱신한다. '더 보기'는 쌓인 영상으로 동작한다.
조회수는 영상이 피드(최신 15개)에서 밀려난 뒤로는 그때 값에서 멈춘다 - 월간 인기는 최근 30일 영상만
보므로 대부분 피드 안에 있다.

[쇼츠 구분] RSS 링크가 /shorts/ 이면 쇼츠. 아니면 https://www.youtube.com/shorts/<id> 를 리다이렉트 없이
요청해서 200이면 쇼츠, 303(일반 영상 주소로 넘김)이면 일반 영상으로 본다. 영상마다 처음 한 번만 확인한다.

GitHub Actions(.github/workflows/update.yml)가 3시간마다 실행한다. 로컬에서도 python scripts/sync_videos.py
"""

import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

CONFIG_PATH = os.path.join('docs', 'data', 'video_channels.json')
OUT_PATH = os.path.join('docs', 'data', 'videos.json')
MAX_VIDEOS = 3000          # 보관 상한(오래된 것부터 버린다). 1건 약 200바이트라 3천 건이면 0.6MB
DELAY = 0.5                # 요청 사이 쉬는 시간(초)
UA = 'Mozilla/5.0 (compatible; staruniv-videos/1.0; +https://ststats.github.io/staruniv)'

NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'yt': 'http://www.youtube.com/xml/schemas/2015',
    'media': 'http://search.yahoo.com/mrss/',
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http_get(url, allow_redirect=True, timeout=20):
    """(상태 코드, 본문 문자열)을 돌려준다. 네트워크 오류면 (0, '')."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'})
    opener = urllib.request.build_opener() if allow_redirect else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as res:
            return res.status, res.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f'  ⚠️ {url}: {e}')
        return 0, ''


def load_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except ValueError as e:
        sys.exit(f'❌ {path} 이 깨졌습니다: {e}')


def write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


def video_id(url):
    m = re.search(r'(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})', str(url or ''))
    return m.group(1) if m else ''


def resolve_channel(url, cached):
    """등록 주소(@handle, /channel/UC..., /c/, /user/) → 채널 id, 제목, 썸네일. 이미 알면 다시 묻지 않는다."""
    if cached and cached.get('id') and cached.get('thumb'):
        return cached
    m = re.search(r'/channel/(UC[\w-]{22})', url)
    cid = m.group(1) if m else ''
    status, page = http_get(url if url.startswith('http') else 'https://www.youtube.com/' + url.lstrip('/'))
    time.sleep(DELAY)
    if not cid and page:
        m = (re.search(r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', page)
             or re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"', page))
        cid = m.group(1) if m else ''
    if not cid:
        print(f'  ⚠️ 채널 id를 찾지 못했습니다: {url} (HTTP {status})')
        return cached or {}
    thumb = ''
    title = ''
    if page:
        m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
        thumb = html.unescape(m.group(1)) if m else ''
        m = re.search(r'<meta property="og:title" content="([^"]+)"', page)
        title = html.unescape(m.group(1)) if m else ''
    return {'id': cid, 'title': title, 'thumb': thumb, 'url': url}


def fetch_feed(channel_id):
    status, body = http_get(f'https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}')
    time.sleep(DELAY)
    if status != 200 or not body:
        print(f'  ⚠️ RSS를 받지 못했습니다: {channel_id} (HTTP {status})')
        return None, []
    root = ET.fromstring(body)
    title = (root.findtext('atom:title', '', NS) or '').strip()
    entries = []
    for e in root.findall('atom:entry', NS):
        vid = e.findtext('yt:videoId', '', NS)
        if not vid:
            continue
        link = e.find('atom:link', NS)
        href = link.get('href', '') if link is not None else ''
        group = e.find('media:group', NS)
        views = 0
        thumb = f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
        if group is not None:
            stats = group.find('media:community/media:statistics', NS)
            if stats is not None:
                try:
                    views = int(stats.get('views', '0'))
                except ValueError:
                    views = 0
            t = group.find('media:thumbnail', NS)
            if t is not None and t.get('url'):
                thumb = t.get('url')
        entries.append({
            'id': vid,
            'title': (e.findtext('atom:title', '', NS) or '').strip(),
            'published': (e.findtext('atom:published', '', NS) or '')[:19],
            'views': views,
            'thumb': thumb,
            'short': True if '/shorts/' in href else None,
        })
    return title, entries


def is_short(vid):
    status, _ = http_get(f'https://www.youtube.com/shorts/{vid}', allow_redirect=False)
    time.sleep(DELAY)
    return status == 200


def oembed(vid):
    q = urllib.parse.quote(f'https://www.youtube.com/watch?v={vid}', safe='')
    status, body = http_get(f'https://www.youtube.com/oembed?url={q}&format=json')
    time.sleep(DELAY)
    if status != 200:
        return {}
    try:
        return json.loads(body)
    except ValueError:
        return {}


def main():
    config = load_json(CONFIG_PATH, {'channels': [], 'picks': []})
    out = load_json(OUT_PATH, {'channels': {}, 'videos': [], 'picks': []})
    known_channels = out.get('channels', {})
    videos = {v['id']: v for v in out.get('videos', []) if v.get('id')}

    channels = {}
    for ch in config.get('channels', []):
        url = str(ch.get('url', '')).strip()
        if not url:
            continue
        info = resolve_channel(url, known_channels.get(url))
        if not info.get('id'):
            continue
        feed_title, entries = fetch_feed(info['id'])
        info = {**info, 'name': str(ch.get('name', '')).strip() or feed_title or info.get('title', '')}
        if feed_title:
            info['title'] = feed_title
        channels[url] = info
        print(f'📺 {info["name"]}: 피드 {len(entries)}개')
        for entry in entries:
            prev = videos.get(entry['id'], {})
            short = entry['short'] if entry['short'] is not None else prev.get('short')
            if short is None:
                short = is_short(entry['id'])
            videos[entry['id']] = {**prev, **entry, 'short': bool(short), 'channel': url}

    # 등록에서 빠진 채널의 영상은 버린다
    kept = [v for v in videos.values() if v.get('channel') in channels]
    kept.sort(key=lambda v: v.get('published', ''), reverse=True)
    kept = kept[:MAX_VIDEOS]

    old_picks = {p['id']: p for p in out.get('picks', []) if p.get('id')}
    picks = []
    for p in config.get('picks', []):
        vid = video_id(p.get('url'))
        if not vid:
            continue
        prev = old_picks.get(vid, {})
        if not prev.get('author'):
            info = oembed(vid)
            prev = {**prev, 'author': info.get('author_name', ''), 'oembedTitle': info.get('title', '')}
        if 'short' not in prev:
            prev['short'] = is_short(vid)
        picks.append({
            **prev,
            'id': vid,
            'title': str(p.get('title', '')).strip() or prev.get('oembedTitle', ''),
            'note': str(p.get('note', '')).strip(),
            'addedAt': str(p.get('addedAt', '')).strip(),
            'thumb': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
        })

    result = {
        'updatedAt': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M'),
        'channels': channels,
        'videos': kept,
        'picks': picks,
    }
    # 내용이 그대로면 시각만 바뀐 커밋이 매번 생기지 않게 파일을 건드리지 않는다
    same = {k: v for k, v in out.items() if k != 'updatedAt'} == {k: v for k, v in result.items() if k != 'updatedAt'}
    if same:
        print('ℹ️ 바뀐 영상이 없습니다.')
        return
    write_atomic(OUT_PATH, result)
    print(f'✅ {OUT_PATH}: 채널 {len(channels)}개, 영상 {len(kept)}개, 보자 {len(picks)}개')


if __name__ == '__main__':
    main()

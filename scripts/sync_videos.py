"""영상 탭 데이터: 어드민이 등록한 유튜브 채널의 최신 영상을 RSS로 모아 docs/data/videos.json에 쌓는다.

[원본] Supabase video_channels / video_picks / videos (SUPABASE_DB_URL이 있을 때)
[장애 fallback] docs/data/video_channels.json + docs/data/videos.json
    { "channels": [ { "url": "https://www.youtube.com/@handle", "name": "표시 이름(선택)" } ],
      "picks":    [ { "url": "https://youtu.be/... 또는 https://vod.sooplive.co.kr/player/<번호>",
                      "title": "(선택, 숲 VOD는 적어주는 게 좋다)", "note": "한 줄 설명",
                      "group": "분류 제목(선택)", "groupEn": "분류 영문 라벨(선택)",
                      "addedAt": "YYYY-MM-DD" } ],
      "hidden":   [ "영상id" ] }        # 사이트에서 감출 영상 (지우지 않고 표시만 한다)

[출력] docs/data/videos.json
    { "updatedAt": "...",
      "channels": { "<등록 url>": { "id": "UC...", "title", "name", "thumb", "url" } },
      "videos":   [ { "id", "channel": "<등록 url>", "title", "published", "views", "thumb", "short", "hidden"(선택) } ],
      "picks":    [ { "id", "kind": "youtube|soop", "title", "note", "group", "groupEn",
                      "addedAt", "author", "thumb", "short" } ] }
    (숲 VOD는 id가 "soop:<번호>"다. 썸네일은 VOD 페이지의 og:image를 한 번 받아 저장해 둔다.)

[두 가지 방식]
 1) 유튜브 API 키가 있으면(환경변수 YOUTUBE_API_KEY) 채널 업로드 목록을 전부 받는다. 과거 영상까지
    한 번에 채워진다. 할당량은 하루 10,000이고 1,000개 채널 하나가 40 정도라 사실상 넉넉하다.
    처음 받는 채널은 전체를, 이미 쌓여 있는 채널은 최신 100개만 훑는다(--full 이면 다시 전체).
 2) 키가 없으면 RSS로 받는다. 키가 필요 없는 대신 채널마다 "최신 15개"만 준다. 그래서 받은 영상을
    이 파일에 계속 쌓아 두고, 피드에 남아 있는 동안 조회수를 갱신한다. 과거 영상은 들어오지 않는다.
어느 쪽이든 조회수는 이번에 훑은 범위 밖으로 밀려나면 그때 값에서 멈춘다 - 월간 인기는 최근 30일
영상만 보므로 대부분 범위 안에 있다.

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
SUPABASE_DB_URL = os.environ.get('SUPABASE_DB_URL', '').strip()
MAX_VIDEOS = 3000          # 보관 상한(오래된 것부터 버린다). 1건 약 200바이트라 3천 건이면 0.6MB

# 유튜브 Data API (선택). 키가 없으면 아래 RSS 방식으로 돈다.
API_KEY = os.environ.get('YOUTUBE_API_KEY', '').strip()
API_BASE = 'https://www.googleapis.com/youtube/v3'
API_PAGE = 50              # playlistItems 한 번에 받는 개수(최대 50)
API_MAX_PAGES = 40         # 채널당 상한 = 50 × 40 = 2,000개
API_RECENT_PAGES = 2       # 이미 쌓인 채널은 최신 100개만 훑는다
SHORT_MAX_SEC = 185        # 쇼츠는 3분 이하 - 이보다 길면 확인할 것도 없이 일반 영상
DELAY = 0.5                # 요청 사이 쉬는 시간(초)
RSS_RETRY = 3              # RSS가 404를 낼 때 다시 시도할 횟수(유튜브 쪽이 들쭉날쭉하다)
RSS_RETRY_WAIT = 4         # 다시 시도하기 전에 쉬는 시간(초). 시도할수록 배로 늘린다
UA = 'Mozilla/5.0 (compatible; staruniv-videos/1.0; +https://ststats.github.io/staruniv)'

NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'yt': 'http://www.youtube.com/xml/schemas/2015',
    'media': 'http://search.yahoo.com/mrss/',
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def encode_url(url):
    """주소에 한글이 들어간 채널(youtube.com/@한글핸들 등)도 요청할 수 있게 퍼센트 인코딩한다.
    urllib은 요청 줄(request line)을 ascii로 보내기 때문에, 그냥 넘기면 UnicodeEncodeError가 난다.
    이미 %xx로 인코딩된 주소를 두 번 인코딩하지 않도록 %는 안전 문자로 둔다."""
    parts = urllib.parse.urlsplit(str(url))
    host = parts.hostname or ''
    try:
        host = host.encode('idna').decode('ascii')       # 한글 도메인
    except Exception:
        host = host.encode('ascii', 'ignore').decode('ascii')
    netloc = f'{host}:{parts.port}' if parts.port else host
    path = urllib.parse.quote(parts.path, safe="/%@:+$,;=~!*'()-._")
    query = urllib.parse.quote(parts.query, safe="%=&?/:@+$,;~!*'()-._")
    return urllib.parse.urlunsplit((parts.scheme, netloc, path, query, ''))


def http_get(url, allow_redirect=True, timeout=20):
    """(상태 코드, 본문 문자열)을 돌려준다. 네트워크 오류면 (0, '')."""
    req = urllib.request.Request(encode_url(url), headers={'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'})
    opener = urllib.request.build_opener() if allow_redirect else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as res:
            return res.status, res.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        # 오류 본문도 돌려준다. 유튜브 API는 왜 막혔는지를 본문에 적어주는데
        # (키 제한·API 미사용 설정·할당량 초과 등) 이걸 버리면 'HTTP 403'만 남아 원인을 알 수 없다.
        try:
            return e.code, e.read().decode('utf-8', 'replace')
        except Exception:
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


def load_supabase_state():
    """Supabase를 영상 탭의 원본으로 사용한다. 연결 정보가 없으면 기존 JSON 모드로 돌아간다."""
    if not SUPABASE_DB_URL:
        return None, None
    try:
        import psycopg
        with psycopg.connect(SUPABASE_DB_URL) as conn, conn.cursor() as cur:
            cur.execute("select channel_url,display_name,source_order,channel_id,title,thumb,uploads,active from public.video_channels order by source_order")
            channel_rows = cur.fetchall()
            cur.execute("select id,channel_url,title,published,thumb,views,short,hidden from public.videos order by published desc nulls last limit %s", (MAX_VIDEOS,))
            video_rows = cur.fetchall()
            cur.execute("select id,kind,title,note,group_name,group_en,added_at,author,thumb,short,hidden,source_order from public.video_picks order by source_order")
            pick_rows = cur.fetchall()
    except Exception as e:
        print(f'  ⚠️ Supabase 영상 원본을 읽지 못해 JSON fallback을 사용합니다: {e}')
        return None, None

    config = {'channels': [], 'picks': [], 'hidden': []}
    out = {'channels': {}, 'videos': [], 'picks': []}
    for url, display_name, order, cid, title, thumb, uploads, active in channel_rows:
        if active:
            config['channels'].append({'url': url, 'name': display_name or '', 'source_order': order})
        out['channels'][url] = {'id': cid or '', 'title': title or '', 'thumb': thumb or '', 'url': url, 'uploads': uploads or '', 'name': display_name or title or ''}
    for vid, url, title, published, thumb, views, short, hidden in video_rows:
        row = {'id': vid, 'channel': url or '', 'title': title or '', 'published': published.isoformat() if published else '', 'thumb': thumb or '', 'views': int(views or 0), 'short': bool(short)}
        if hidden:
            row['hidden'] = True; config['hidden'].append(vid)
        out['videos'].append(row)
    for vid, kind, title, note, group_name, group_en, added_at, author, thumb, short, hidden, order in pick_rows:
        url = f'https://vod.sooplive.co.kr/player/{str(vid)[5:]}' if str(vid).startswith('soop:') else f'https://youtu.be/{vid}'
        config['picks'].append({'url': url, 'title': title or '', 'note': note or '', 'group': group_name or '', 'groupEn': group_en or '', 'addedAt': added_at.isoformat() if added_at else '', 'source_order': order})
        row = {'id': vid, 'kind': kind or ('soop' if str(vid).startswith('soop:') else 'youtube'), 'title': title or '', 'note': note or '', 'group': group_name or '', 'groupEn': group_en or '', 'addedAt': added_at.isoformat() if added_at else '', 'author': author or '', 'thumb': thumb or '', 'short': bool(short), 'source_order': order}
        if hidden:
            row['hidden'] = True; config['hidden'].append(vid)
        out['picks'].append(row)
    return config, out


def save_supabase_state(channels, videos, picks):
    """동기화 결과를 Supabase에 UPSERT한다. 정적 videos.json은 장애 대비 스냅샷으로도 계속 남긴다."""
    if not SUPABASE_DB_URL:
        return
    import psycopg
    with psycopg.connect(SUPABASE_DB_URL) as conn, conn.cursor() as cur:
        for url, info in channels.items():
            cur.execute("""
                update public.video_channels set channel_id=%s,title=%s,thumb=%s,uploads=%s,updated_at=now()
                where channel_url=%s
            """, (info.get('id') or None, info.get('title') or None, info.get('thumb') or None, info.get('uploads') or None, url))
        for v in videos:
            cur.execute("""
                insert into public.videos(id,channel_url,title,published,thumb,views,short,hidden,updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,now())
                on conflict(id) do update set channel_url=excluded.channel_url,title=excluded.title,published=excluded.published,
                  thumb=excluded.thumb,views=excluded.views,short=excluded.short,hidden=excluded.hidden,updated_at=now()
            """, (v.get('id'), v.get('channel') or None, v.get('title') or '', v.get('published') or None, v.get('thumb') or None, int(v.get('views') or 0), bool(v.get('short')), bool(v.get('hidden'))))
        for i, p in enumerate(picks, 1):
            order = int(p.get('source_order') or i)
            cur.execute("""
                insert into public.video_picks(id,kind,title,note,group_name,group_en,added_at,author,thumb,short,hidden,source_order,updated_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
                on conflict(id) do update set kind=excluded.kind,title=excluded.title,note=excluded.note,group_name=excluded.group_name,
                  group_en=excluded.group_en,added_at=excluded.added_at,author=excluded.author,thumb=excluded.thumb,short=excluded.short,
                  hidden=excluded.hidden,source_order=excluded.source_order,updated_at=now()
            """, (p.get('id'), p.get('kind') or 'youtube', p.get('title') or '', p.get('note') or None, p.get('group') or None, p.get('groupEn') or None, p.get('addedAt') or None, p.get('author') or None, p.get('thumb') or None, bool(p.get('short')), bool(p.get('hidden')), order))
        conn.commit()


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


def fetch_rss(channel_id):
    """RSS 원문을 받아온다. (본문, 채널 피드였는지) - 못 받으면 (None, False).

    2025년 말부터 유튜브 RSS(feeds/videos.xml)가 멀쩡한 채널에도 404를 내는 일이 잦다.
    유튜브 쪽 문제라 우리가 고칠 수는 없고, 대신 두 가지로 버틴다.
      1) 같은 채널을 '업로드 재생목록'(채널 id의 UC → UU) 주소로도 물어본다. 한쪽이 404여도
         다른 쪽이 오는 경우가 많다.
      2) 그래도 안 되면 잠깐 쉬었다 다시 시도한다(몇 분~몇 시간 단위로 됐다 안 됐다 한다).
    이 단계가 끝내 실패해도 저장해둔 영상은 그대로 두니 사이트가 비지는 않는다.
    """
    base = 'https://www.youtube.com/feeds/videos.xml'
    tries = [(f'{base}?channel_id={channel_id}', True),
             (f'{base}?playlist_id=UU{channel_id[2:]}', False)]
    for attempt in range(RSS_RETRY):
        for url, is_channel_feed in tries:
            status, body = http_get(url)
            time.sleep(DELAY)
            if status == 200 and body:
                return body, is_channel_feed
        if attempt + 1 < RSS_RETRY:
            time.sleep(RSS_RETRY_WAIT * (attempt + 1))
    return None, False


def fetch_feed(channel_id):
    body, is_channel_feed = fetch_rss(channel_id)
    if not body:
        print(f'  ⚠️ RSS를 받지 못했습니다: {channel_id}')
        print('     유튜브 RSS가 멀쩡한 채널에도 404를 내는 날이 있습니다(유튜브 쪽 문제).')
        print('     자주 겪는다면 YOUTUBE_API_KEY 시크릿을 넣어주세요 - API로 받으면 이 문제가 없고 과거 영상도 전부 받습니다.')
        return None, []
    root = ET.fromstring(body)
    # 업로드 재생목록 피드의 제목은 채널 이름이 아닐 수 있어 채널 피드일 때만 쓴다.
    title = (root.findtext('atom:title', '', NS) or '').strip() if is_channel_feed else ''
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


def soop_vod_no(url):
    """숲(SOOP) VOD 주소에서 VOD 번호를 뽑는다. 아니면 ''.

    받는 모양 (도메인은 sooplive.co.kr / sooplive.com / 예전 afreecatv.com 다 받는다)
      https://vod.sooplive.co.kr/player/109613658
      https://vod.sooplive.co.kr/player/109613658/embed?...
      https://vod.afreecatv.com/PLAYER/STATION/109613658
      https://www.sooplive.co.kr/video/109613658
    """
    u = str(url or '')
    if not re.search(r'https?://[\w.-]*(sooplive\.(?:co\.kr|com)|afreecatv\.com)/', u, re.I):
        return ''
    m = re.search(r'/(?:player|video|PLAYER/STATION)/(\d{1,20})', u, re.I)
    return m.group(1) if m else ''


def soop_vod_thumb(no):
    """숲 VOD 페이지의 og:image(미리보기 그림). 못 받으면 ''를 준다 - 사이트에서 글자 썸네일로 대신한다."""
    status, page = http_get(f'https://vod.sooplive.co.kr/player/{no}')
    time.sleep(DELAY)
    if status != 200 or not page:
        return ''
    m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    thumb = html.unescape(m.group(1)) if m else ''
    return thumb if thumb.startswith('https://') else ''


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


def api_get(path, **params):
    """유튜브 Data API 호출. 실패하면 RuntimeError - 부르는 쪽에서 RSS로 물러난다."""
    params['key'] = API_KEY
    status, body = http_get(f'{API_BASE}/{path}?' + urllib.parse.urlencode(params))
    time.sleep(DELAY)
    if status != 200:
        detail = ''
        try:
            detail = json.loads(body).get('error', {}).get('message', '')
        except Exception:
            pass
        raise RuntimeError(f'유튜브 API {path} 실패 (HTTP {status}) {detail}'.strip())
    return json.loads(body)


def api_channel(url, cached):
    """등록 주소 → { id, title, thumb, url, uploads(업로드 재생목록 id) }"""
    m = re.search(r'/channel/(UC[\w-]{22})', url)
    params = {'part': 'snippet,contentDetails'}
    if m:
        params['id'] = m.group(1)
    elif re.search(r'/@([^/?#]+)', url):
        params['forHandle'] = '@' + urllib.parse.unquote(re.search(r'/@([^/?#]+)', url).group(1))
    elif re.search(r'/user/([^/?#]+)', url):
        params['forUsername'] = urllib.parse.unquote(re.search(r'/user/([^/?#]+)', url).group(1))
    else:
        # /c/이름 처럼 API가 바로 못 찾는 형태는 예전 방식으로 채널 id만 알아낸 뒤 API로 넘긴다
        found = resolve_channel(url, cached)
        if not found.get('id'):
            raise RuntimeError('채널 id를 찾지 못했습니다')
        params['id'] = found['id']

    items = api_get('channels', **params).get('items') or []
    if not items:
        raise RuntimeError('채널을 찾지 못했습니다')
    it = items[0]
    sn = it.get('snippet') or {}
    thumbs = sn.get('thumbnails') or {}
    thumb = (thumbs.get('high') or thumbs.get('medium') or thumbs.get('default') or {}).get('url', '')
    return {
        'id': it['id'],
        'title': sn.get('title', ''),
        'thumb': thumb,
        'url': url,
        'uploads': ((it.get('contentDetails') or {}).get('relatedPlaylists') or {}).get('uploads', ''),
    }


def api_uploads(playlist_id, max_pages):
    """업로드 재생목록에서 영상 목록(최신순). [{id, title, published, thumb}]"""
    out, token = [], None
    for _ in range(max_pages):
        params = {'part': 'snippet,contentDetails', 'playlistId': playlist_id, 'maxResults': API_PAGE}
        if token:
            params['pageToken'] = token
        data = api_get('playlistItems', **params)
        for it in data.get('items') or []:
            sn = it.get('snippet') or {}
            vid = ((it.get('contentDetails') or {}).get('videoId')
                   or (sn.get('resourceId') or {}).get('videoId') or '')
            if not re.fullmatch(r'[A-Za-z0-9_-]{11}', vid):
                continue
            thumbs = sn.get('thumbnails') or {}
            out.append({
                'id': vid,
                'title': (sn.get('title') or '').strip(),
                'published': ((it.get('contentDetails') or {}).get('videoPublishedAt')
                              or sn.get('publishedAt') or '')[:19],
                'thumb': (thumbs.get('medium') or thumbs.get('high') or thumbs.get('default') or {})
                         .get('url', f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'),
            })
        token = data.get('nextPageToken')
        if not token:
            break
    return out


def iso_duration_sec(text):
    """PT1H2M3S → 3723초. 못 읽으면 0."""
    m = re.fullmatch(r'P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', str(text or ''))
    if not m:
        return 0
    h, mi, se = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + se


def api_stats(ids):
    """영상 id 목록 → { id: (조회수, 길이초) }. 50개씩 끊어 부른다."""
    out = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        data = api_get('videos', part='statistics,contentDetails', id=','.join(chunk), maxResults=50)
        for it in data.get('items') or []:
            try:
                views = int((it.get('statistics') or {}).get('viewCount', 0))
            except (TypeError, ValueError):
                views = 0
            out[it['id']] = (views, iso_duration_sec((it.get('contentDetails') or {}).get('duration')))
    return out


def collect_with_api(url, cached, archived_count, full):
    """API로 채널 정보 + 영상 목록을 받는다. (채널정보, [영상])"""
    info = api_channel(url, cached)
    if not info.get('uploads'):
        raise RuntimeError('업로드 재생목록을 찾지 못했습니다')
    pages = API_MAX_PAGES if (full or not archived_count) else API_RECENT_PAGES
    items = api_uploads(info['uploads'], pages)
    stats = api_stats([v['id'] for v in items])
    videos = []
    for v in items:
        views, sec = stats.get(v['id'], (0, 0))
        videos.append({**v, 'views': views,
                       # 3분을 넘으면 쇼츠일 수 없다. 짧은 것만 뒤에서 한 번 확인한다.
                       'short': None if (sec and sec <= SHORT_MAX_SEC) else False})
    return info, videos


def main():
    full = '--full' in sys.argv        # API 키가 있을 때 과거 영상까지 다시 전부 받는다
    if API_KEY:
        print(f'▶ 유튜브 API 키로 받습니다{" (전체 다시 받기)" if full else ""}')
    else:
        print('▶ API 키가 없어 RSS로 받습니다 (채널당 최신 15개)')
    config, out = load_supabase_state()
    if config is None:
        config = load_json(CONFIG_PATH, {'channels': [], 'picks': []})
        out = load_json(OUT_PATH, {'channels': {}, 'videos': [], 'picks': []})
    else:
        print('▶ 영상 채널/추천/숨김 설정은 Supabase 원본을 사용합니다.')
    known_channels = out.get('channels', {})
    videos = {v['id']: v for v in out.get('videos', []) if v.get('id')}

    channels = {}
    for ch in config.get('channels', []):
        url = str(ch.get('url', '')).strip()
        if not url:
            continue
        # 채널 하나가 잘못돼도(주소 오타·삭제된 채널 등) 나머지 채널은 계속 받는다.
        try:
            archived = sum(1 for v in videos.values() if v.get('channel') == url)
            entries, feed_title, info = None, '', {}
            if API_KEY:
                try:
                    info, entries = collect_with_api(url, known_channels.get(url), archived, full)
                    feed_title = info.get('title', '')
                except Exception as e:                      # 키 문제·할당량 초과 등은 RSS로 물러난다
                    print(f'  ⚠️ API로 받지 못해 RSS로 받습니다: {e}')
                    print('     (403이면 키의 "애플리케이션 제한"을 없음으로 두었는지, '
                          'Google Cloud 프로젝트에서 YouTube Data API v3를 사용 설정했는지 확인해주세요)')
                    entries = None
            if entries is None:
                info = resolve_channel(url, known_channels.get(url))
                if not info.get('id'):
                    # 채널 id를 못 찾았다고 이 채널을 목록에서 빼면, 아래 kept 필터에서 그동안
                    # 쌓아둔 이 채널 영상이 통째로 사라진다. 지난번 정보를 그대로 살려 둔다.
                    if known_channels.get(url):
                        channels[url] = known_channels[url]
                    continue
                feed_title, entries = fetch_feed(info['id'])
            info = {**info, 'name': str(ch.get('name', '')).strip() or feed_title or info.get('title', '')}
            if feed_title:
                info['title'] = feed_title
            channels[url] = info
            print(f'📺 {info["name"]}: {len(entries)}개 (보관 {archived}개)')
            for entry in entries:
                prev = videos.get(entry['id'], {})
                short = entry['short'] if entry['short'] is not None else prev.get('short')
                if short is None:
                    short = is_short(entry['id'])
                videos[entry['id']] = {**prev, **entry, 'short': bool(short), 'channel': url}
        except Exception as e:
            print(f'  ⚠️ {url} 은(는) 건너뜁니다: {type(e).__name__}: {e}')
            # 지난번에 받아둔 정보가 있으면 그대로 살려 둔다(이 채널 영상이 목록에서 사라지지 않게)
            if known_channels.get(url):
                channels[url] = known_channels[url]

    # 등록에서 빠진 채널의 영상은 버린다
    kept = [v for v in videos.values() if v.get('channel') in channels]
    kept.sort(key=lambda v: v.get('published', ''), reverse=True)
    kept = kept[:MAX_VIDEOS]

    old_picks = {p['id']: p for p in out.get('picks', []) if p.get('id')}
    picks = []
    for p in config.get('picks', []):
        vid = video_id(p.get('url'))
        soop_no = '' if vid else soop_vod_no(p.get('url'))
        if not vid and not soop_no:
            continue
        # 숲 VOD는 id를 'soop:<번호>'로 둔다(유튜브 id와 섞이지 않게).
        key = vid or f'soop:{soop_no}'
        prev = old_picks.get(key, {})
        if soop_no:
            # 제목은 어드민이 적은 걸 쓴다(숲 페이지의 제목은 '숲'으로만 오는 경우가 많다).
            # 썸네일은 한 번 받아두면 다시 묻지 않는다.
            if not prev.get('thumb'):
                prev = {**prev, 'thumb': soop_vod_thumb(soop_no)}
            prev = {**prev, 'author': prev.get('author') or '숲 VOD', 'short': False}
        else:
            if not prev.get('author'):
                info = oembed(vid)
                prev = {**prev, 'author': info.get('author_name', ''), 'oembedTitle': info.get('title', '')}
            if 'short' not in prev:
                prev['short'] = is_short(vid)
            prev = {**prev, 'thumb': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'}
        picks.append({
            **prev,
            'id': key,
            'kind': 'soop' if soop_no else 'youtube',
            'title': str(p.get('title', '')).strip() or prev.get('oembedTitle', '') or ('숲 VOD' if soop_no else ''),
            'note': str(p.get('note', '')).strip(),
            # 분류 제목. 같은 값끼리 사이트에서 한 묶음으로 묶여 제목줄이 생긴다.
            'group': str(p.get('group', '')).strip(),
            # 분류 제목 위에 붙는 작은 영문 라벨(선택).
            'groupEn': str(p.get('groupEn', '')).strip(),
            'addedAt': str(p.get('addedAt', '')).strip(),
            'source_order': p.get('source_order'),
        })

    # 어드민에서 감춘 영상은 목록에서 빼지 않고 표시만 해 둔다(되돌리기가 바로 되도록).
    hidden = {str(i) for i in (config.get('hidden') or []) if re.fullmatch(r'[A-Za-z0-9_-]{11}', str(i))}
    for v in kept:
        if v['id'] in hidden:
            v['hidden'] = True
        else:
            v.pop('hidden', None)
    for p_ in picks:
        if p_['id'] in hidden:
            p_['hidden'] = True
        else:
            p_.pop('hidden', None)

    result = {
        'updatedAt': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M'),
        'channels': channels,
        'videos': kept,
        'picks': picks,
    }
    # 내용이 그대로면 시각만 바뀐 커밋이 매번 생기지 않게 파일을 건드리지 않는다
    same = {k: v for k, v in out.items() if k != 'updatedAt'} == {k: v for k, v in result.items() if k != 'updatedAt'}
    if SUPABASE_DB_URL:
        save_supabase_state(channels, kept, picks)
        print(f'✅ Supabase videos 갱신: 채널 {len(channels)}개, 영상 {len(kept)}개, 보자 {len(picks)}개')
    if same:
        print('ℹ️ fallback videos.json 내용은 바뀌지 않았습니다.')
        return
    write_atomic(OUT_PATH, result)
    print(f'✅ fallback {OUT_PATH}: 채널 {len(channels)}개, 영상 {len(kept)}개, 보자 {len(picks)}개')


if __name__ == '__main__':
    main()

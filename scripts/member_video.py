"""멤버 대표 영상 서버 편집(모바일에서 올린 원본용).

어드민 멤버 수정에서 영상을 올렸는데 브라우저가 직접 줄이지 못하면(모바일 등) 원본을
Storage(staruniv-media/members-photo-raw/)에 두고 media_jobs에 작업을 넣는다. Supabase
(admin_request_member_video)가 이 스크립트를 GitHub Actions(member-video.yml)로 실행한다.

  원본 받기 → ffmpeg로 720×404(가운데 기준으로 잘라 16:9) · 30fps · 소리 없음 · 최대 6초 H.264 MP4
  → members-photo/에 올리기(브라우저 캐시 1년) → members.photo_path 바꾸기 → 원본 지우기

필요한 환경변수: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(Storage 올리기·지우기), JOB_ID
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

BUCKET = 'staruniv-media'
RAW_PREFIX = 'members-photo-raw/'
OUT_PREFIX = 'members-photo/'
MAX_RAW_BYTES = 10 * 1024 * 1024
# 브라우저 편집(admin-members.js CLIP)과 같은 결과가 나오게 맞춘다
FFMPEG_ARGS = [
    '-t', '6', '-an',
    '-vf', 'fps=30,scale=720:404:force_original_aspect_ratio=increase:flags=lanczos,crop=720:404',
    '-c:v', 'libx264', '-profile:v', 'main', '-crf', '26', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
]


def env(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise SystemExit(f'{name} 환경변수가 필요합니다(저장소 Settings → Secrets)')
    return value


def storage_request(method: str, path: str, data: bytes | None = None, headers: dict | None = None):
    base = env('SUPABASE_URL').rstrip('/')
    key = env('SUPABASE_SERVICE_ROLE_KEY')
    quoted = '/'.join(urllib.parse.quote(part) for part in path.split('/'))
    req = urllib.request.Request(f'{base}/storage/v1/object/{BUCKET}/{quoted}', data=data, method=method)
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('apikey', key)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def safe_raw_path(path: str) -> str:
    path = str(path or '').strip()
    if not path.startswith(RAW_PREFIX) or '..' in path or not re.fullmatch(r'[A-Za-z0-9_./-]+', path):
        raise ValueError(f'원본 경로가 올바르지 않습니다: {path!r}')
    return path


def transcode(src: str, dst: str) -> None:
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('ffmpeg가 없습니다')
    result = subprocess.run([ffmpeg, '-y', '-v', 'error', '-i', src, *FFMPEG_ARGS, dst],
                            capture_output=True, text=True, timeout=300)
    if result.returncode != 0 or not os.path.getsize(dst):
        raise RuntimeError(f'ffmpeg 실패: {result.stderr.strip()[-400:]}')


def run(job_id: int) -> None:
    import psycopg
    conn = psycopg.connect(env('SUPABASE_DB_URL'), autocommit=True)
    row = conn.execute('select member_id, raw_path, status from public.media_jobs where id = %s', (job_id,)).fetchone()
    if not row:
        raise SystemExit(f'작업 {job_id}이 없습니다')
    member_id, raw_path, status = row
    if status not in ('queued', 'failed'):
        print(f'작업 {job_id}은 이미 {status}입니다')
        return
    conn.execute("update public.media_jobs set status = 'running', started_at = now(), error = null where id = %s", (job_id,))
    try:
        raw_path = safe_raw_path(raw_path)
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'raw')
            dst = os.path.join(tmp, 'out.mp4')
            data = storage_request('GET', raw_path)
            if len(data) > MAX_RAW_BYTES:
                raise RuntimeError('원본이 10MB를 넘습니다')
            with open(src, 'wb') as fh:
                fh.write(data)
            transcode(src, dst)
            with open(dst, 'rb') as fh:
                out = fh.read()
            stem = re.sub(r'[^A-Za-z0-9_-]', '-', os.path.basename(raw_path).rsplit('.', 1)[0])[:60] or 'clip'
            out_path = f'{OUT_PREFIX}{stem}-{int(time.time() * 1000)}.mp4'
            storage_request('POST', out_path, out, {
                'Content-Type': 'video/mp4', 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false',
            })
        updated = conn.execute('update public.members set photo_path = %s where id = %s', (out_path, member_id)).rowcount
        if not updated:
            raise RuntimeError(f'멤버 {member_id}이 없습니다(그사이 지워졌을 수 있음)')
        conn.execute("update public.media_jobs set status = 'done', result_path = %s, finished_at = now() where id = %s",
                     (out_path, job_id))
        print(f'완료: {raw_path} ({len(data) // 1024}KB) → {out_path} ({len(out) // 1024}KB)')
        try:
            storage_request('DELETE', raw_path)
        except Exception as exc:  # 원본 지우기는 실패해도 결과에는 영향이 없다
            print(f'원본 삭제 실패(무시): {exc}')
    except Exception as exc:
        conn.execute("update public.media_jobs set status = 'failed', error = %s, finished_at = now() where id = %s",
                     (str(exc)[:500], job_id))
        raise


if __name__ == '__main__':
    run(int(env('JOB_ID')))
    sys.exit(0)

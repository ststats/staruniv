#!/usr/bin/env python3
"""현재 Git의 운영 이미지를 Supabase Storage로 1회 이전한다.
필수 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
먼저 supabase/content_media.sql 실행 후 사용.
"""
from pathlib import Path
import json, mimetypes, os, urllib.parse, urllib.request
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ['SUPABASE_URL'].rstrip('/')
KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
BUCKET='staruniv-media'
HEAD={'apikey':KEY,'Authorization':'Bearer '+KEY}
def req(method,url,data=None,headers=None):
    h={**HEAD,**(headers or {})}; r=urllib.request.Request(url,data=data,headers=h,method=method)
    with urllib.request.urlopen(r) as x: return x.read()
def upload(local,path):
    ctype=mimetypes.guess_type(local.name)[0] or 'application/octet-stream'
    q='/'.join(urllib.parse.quote(x,safe='') for x in path.split('/'))
    req('POST',f'{URL}/storage/v1/object/{BUCKET}/{q}',local.read_bytes(),{'Content-Type':ctype,'x-upsert':'true'})
def get_rows(table,select='*'):
    raw=req('GET',f'{URL}/rest/v1/{table}?select={urllib.parse.quote(select)}',headers={'Accept':'application/json'})
    return json.loads(raw or b'[]')
def patch(table,filter_expr,obj):
    req('PATCH',f'{URL}/rest/v1/{table}?{filter_expr}',json.dumps(obj).encode(),{'Content-Type':'application/json','Prefer':'return=minimal'})

# 연혁 사진
for row in get_rows('history_entries','id,image_path'):
    old=row.get('image_path') or ''
    if not old.startswith('data/history/'): continue
    local=ROOT/'docs'/old
    if not local.exists(): continue
    dest='history/'+local.name
    upload(local,dest); patch('history_entries','id=eq.'+urllib.parse.quote(row['id'],safe=''),{'image_path':dest}); print('history',row['id'],dest)

# 팀 로고: DB에 등록된 팀 이름과 같은 Git 이미지가 있으면 이전
for row in get_rows('teams','id,team_name,logo_path'):
    if row.get('logo_path'): continue
    local=ROOT/'docs'/'images'/f"{row['team_name']}.webp"
    if not local.exists(): continue
    dest=f"teams/{row['id']}.webp"
    upload(local,dest); patch('teams','id=eq.'+str(row['id']),{'logo_path':dest}); print('team',row['team_name'],dest)

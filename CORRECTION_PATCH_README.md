# 영상 탭 + 외부도구 수정 패치

이번 수정은 기능을 다음처럼 분리합니다.

- **연혁 관리**: 연혁 자체를 관리하며 사진/YouTube URL은 선택 첨부 필드입니다.
- **영상 관리**: 사이트의 별도 `영상` 탭을 관리합니다. 팬튜브 채널, 자동 수집 영상 노출, `보자` 추천 영상이 대상입니다.
- **외부도구 관리**: `도구 > 외부도구` 서브탭의 외부 링크를 관리합니다.
- **멀티뷰어 / 엔트리 / 캄몬라이더**: 기존 Git 코드 그대로이며 DB 관리 대상이 아닙니다.

## 적용

1. ZIP 내용을 기존 프로젝트 루트에 덮어씁니다.
2. Supabase SQL 적용:
   - **기존 `setup.sql`을 아직 실행하지 않았다면**: 새 `supabase/setup.sql` 전체를 1회 실행합니다.
   - **이전 최종 패치의 `setup.sql`을 이미 실행했다면**: `supabase/video_tools_patch.sql`만 실행합니다. 이 파일은 캘린더/휴방/연혁 데이터를 다시 시드하지 않습니다.
3. 코드 변경을 Git에 커밋/푸시합니다.

```cmd
git add .
git commit -m "Add Supabase video and external tools management"
git push origin main
```

## 영상 자동 수집

`scripts/sync_videos.py`는 GitHub Actions에서 `SUPABASE_DB_URL`이 있으면 `video_channels` 설정을 Supabase에서 읽고, 수집한 영상을 `videos` 테이블에 직접 저장합니다. `docs/data/videos.json`은 장애 시 fallback 스냅샷으로 남습니다.

## 확인

- 관리자 → **연혁**: 명칭이 `연혁 관리`, 사진/YouTube는 선택 첨부
- 관리자 → **영상 관리**: 팬튜브 채널 / 보자 추천 / 자동 수집 영상 숨김·표시
- 관리자 → **외부도구**: 링크 추가/수정/삭제
- 공개 `영상` 탭: Supabase 우선 조회
- `도구 > 외부도구`: Supabase 우선 조회
- `도구 > 멀티뷰어`: 기존 동작 그대로

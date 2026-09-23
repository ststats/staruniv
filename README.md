# 스타유니브 어드민 직접 배포 수정본

현재 GitHub main의 구조를 기준으로 맞춘 패치입니다.

- `templates/assets/page-admin.js`: iframe이 없는 새 admin HTML에서도 초기화 오류가 나지 않도록 수정. 실제 Supabase 설정 오류와 일반 JS 초기화 오류를 분리.
- `docs/page-admin.js`: 위 파일의 배포본. 워크플로우 없이 즉시 배포 가능.
- `templates/assets/admin.css`: 본페이지 디자인 토큰을 사용한 새 편집 콘솔 UI.
- `docs/admin.css`: 위 CSS의 배포본. 워크플로우 없이 즉시 배포 가능.

현재 `docs/supabase-config.js`에 공개 URL/publishable key가 이미 존재하므로 새 키/변수 추가는 필요하지 않습니다.

적용 후 브라우저 캐시가 남아 있으면 관리자 페이지에서 Ctrl+F5 한 번만 하세요.

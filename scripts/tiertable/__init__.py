"""펨코 스타 티어표 분석(scripts/tier_table.py가 실행한다). 모듈은 역할별로 나눴다:

    layout   카드 모양과 공통 상수
    sources  입력(이미지·DB 명단)
    features 칸 그림 특징(글씨 잉크 농도·닉네임 칸 거리·사진 지문)
    cards    이미지 → 카드(구역 나누기·카드 찾기·글씨 읽기)
    memory   기억(학습)
    fa       FA 명단 글
    compare  DB와 맞추기(변동·확인할 것)
    job      Actions 작업 모드(tier_update_jobs)
"""

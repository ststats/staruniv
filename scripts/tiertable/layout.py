"""카드 모양과 공통 상수(원본 폭 1100px 기준)."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

TIER_WORDS = {'god': '갓', 'king': '킹', 'jack': '잭', 'joker': '조커', 'spade': '스페이드', 'baby': '베이비', 'check': '체크'}
RACES = {'protoss': '프로토스', 'terran': '테란', 'zerg': '저그', 'random': '랜덤'}
NO_RACE = '미정'   # '종족미정' 카드 글씨는 빈 값('-')으로 읽는다
ROLES = ('이사장', '부총장', '총장', '교수', '코치', '대장', '수장', '단장')

# 사진 80px, 오른쪽 5px부터 글씨 세 줄(티어·직책+닉네임·종족). 구역 머리는 위쪽 HEADER px 안에 있다.
PHOTO, HEADER = 80, 125
TIER_BOX, RACE_BOX = (120, 24), (120, 23)   # (폭, 높이). 늘리지 않고 원본 크기로 비교한다
NAME_BOX = (125, 24)
# 닉네임 칸 그림 거리가 이 이하면 같은 이름으로 보고 OCR을 건너뛴다.
# 실측: 같은 카드 재압축은 대부분 0.10 이하, 다른 닉네임은 가장 비슷한 쌍도 0.13.
NAME_SAME = 0.10
DIGIT_W = 22

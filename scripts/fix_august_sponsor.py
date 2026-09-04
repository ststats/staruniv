"""
8월 누락 스폰전적 소급 적용 스크립트 (일회용)
타임스탬프는 변경하지 않고 오직 스폰전적(승/패)만 덮어씌웁니다.

재조회가 성공했는데(sponsor_list가 비어있지 않은데) 특정 멤버가 결과에 없는
경우 -> 그 사람은 8월에 진짜 0판이라는 뜻이다(API가 참가자만 돌려주고 0판인
사람은 아예 안 준다). 이런 사람을 그냥 안 건드리고 넘어가면, 결측 사고 기간에
잘못 섞여 들어간 값이 그대로 남을 수 있어서, 매칭 안 된 사람도 명시적으로
0승 0패로 확정한다.

반대 방향(재조회 결과엔 있는데 8월 아카이브 로스터엔 없는 elo_id, 즉 "미상")도
처리한다 - 8월 당시엔 로스터에 없었지만 실제로 8월에 경기를 뛴 사람이 결측
사고 때문에 누락됐던 경우다. 현재 members.xlsx에도 없는 완전히 새로운 elo_id면
평소 update_data.py가 하는 것과 같은 방식으로 "미상(elo_N)" 임시 프로필을
xlsx에 추가하고, 8월 아카이브에도 그 사람 기록을 새로 끼워넣는다(별풍선/
방송시간/누적시청자는 이 스크립트 범위 밖이라 0으로 - 스폰전적만 다룬다).
"""
import sys
from _common import ROOT, safe_read_json, atomic_write_json, load_xlsx_members, write_xlsx
from fetch_eloboard_data import aggregate_period_data


def main():
    start_date = "2026-08-01"
    end_date = "2026-08-31"
    archive_path = ROOT / "data" / "archive" / "2026-08-31.json"
    if not archive_path.exists():
        print(f"[오류] 아카이브 파일이 없습니다: {archive_path}")
        sys.exit(1)
    archive_data = safe_read_json(archive_path)
    if not archive_data:
        print("[오류] 아카이브 파일을 읽을 수 없습니다.")
        sys.exit(1)
    print(f"[수집] {start_date} ~ {end_date} 엘로보드 스폰전적 재조회 중...")

    try:
        sponsor_list = aggregate_period_data(start_date, end_date)
    except Exception as e:
        print(f"[오류] 엘로보드 수집 중 예외 발생: {e}")
        sys.exit(1)
    if not sponsor_list:
        print("[경고] 수집된 데이터가 없습니다. 스크립트를 종료합니다.")
        sys.exit(1)

    sponsor_dict = {item["id"]: item for item in sponsor_list if item.get("id")}
    changed = 0
    matched_elo_ids = set()
    for m in archive_data.get("members", []):
        elo_id = m.get("elo_id")
        if elo_id is None:
            continue
        matched_elo_ids.add(str(elo_id))
        src = sponsor_dict.get(str(elo_id))
        new_wins = src["sponsor_wins"] if src else 0
        new_losses = src["sponsor_losses"] if src else 0
        old_wins, old_losses = m.get("sponsor_wins"), m.get("sponsor_losses")
        if old_wins != new_wins or old_losses != new_losses:
            print(f"  {m.get('nickname', m.get('id'))}: {old_wins}승{old_losses}패 -> {new_wins}승{new_losses}패")
            m["sponsor_wins"] = new_wins
            m["sponsor_losses"] = new_losses
            changed += 1

    # 재조회 결과엔 있는데 8월 아카이브 로스터엔 없던 elo_id("미상") 처리
    unknown_elo_ids = set(sponsor_dict.keys()) - matched_elo_ids
    if unknown_elo_ids:
        member_map = load_xlsx_members()
        elo_id_to_fields = {
            str(fields["elo_id"]): {**fields, "id": soop_id}
            for soop_id, fields in member_map.items()
            if fields.get("elo_id") is not None
        }
        new_members_for_xlsx = []
        for elo_id_str in sorted(unknown_elo_ids):
            src = sponsor_dict[elo_id_str]
            known = elo_id_to_fields.get(elo_id_str)
            if known is None:
                # 현재 로스터(xlsx)에도 없는 완전히 새로운 사람 - 평소
                # update_data.py가 하는 것과 같은 형식으로 임시 프로필을
                # xlsx에 등록한다.
                known = {
                    "id": f"elo_{elo_id_str}",
                    "nickname": f"미상(elo_{elo_id_str})",
                    "elo_id": int(elo_id_str),
                    "birthdate": None,
                    "gender": "",
                    "race": "",
                    "tier": "",
                    "team": "",
                    "role": "",
                    "info_updated_at": None,
                }
                new_members_for_xlsx.append(known)
                elo_id_to_fields[elo_id_str] = known
                print(f"  [신규] 미상(elo_{elo_id_str}) - members.xlsx에 새로 등록됨")
            else:
                print(f"  [보완] {known.get('nickname')}(elo_{elo_id_str}) - "
                      f"현재 로스터엔 있으나 8월 아카이브엔 누락돼있어 추가함")

            # xlsx 등록 여부와 무관하게, 8월 아카이브 자체엔 이 사람 기록이
            # 아예 없었으니 새 항목으로 끼워넣는다 - known에 그 사람의 실제
            # 정보(이미 로스터에 있던 사람이면 진짜 닉네임/id/팀 등, 완전
            # 신규면 방금 만든 미상 placeholder)를 그대로 쓴다. 별풍선/
            # 방송시간/누적시청자는 이 스크립트가 다루는 범위가 아니라(스폰전적
            # 전용) 0으로 둔다.
            archive_data.setdefault("members", []).append({
                "id": known.get("id"),
                "elo_id": int(elo_id_str),
                "nickname": known.get("nickname"),
                "role": known.get("role") or "",
                "team": known.get("team") or "",
                "race": known.get("race") or "",
                "tier": known.get("tier") or "",
                "balloons": 0,
                "broadcast_seconds": 0,
                "cumulative_viewers": 0,
                "sponsor_wins": src["sponsor_wins"],
                "sponsor_losses": src["sponsor_losses"],
            })
            changed += 1

        if new_members_for_xlsx:
            write_xlsx({}, new_members_for_xlsx)
            print(f"[완료] {len(new_members_for_xlsx)}명의 신규 미상 프로필이 members.xlsx에 추가되었습니다.")

    if changed:
        atomic_write_json(archive_path, archive_data)
        print(f"[완료] {archive_path.name} 파일에 8월 스폰전적 정정이 성공적으로 반영되었습니다. "
              f"({changed}명 변경, 타임스탬프 유지)")
    else:
        print("[알림] 갱신할 내용이 없습니다.")


if __name__ == "__main__":
    main()

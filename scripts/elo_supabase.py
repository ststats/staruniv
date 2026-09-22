"""ELO archive와 Supabase elo_* 테이블 사이의 작은 공통 유틸리티."""
from __future__ import annotations

from datetime import date


def _date_value(value):
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def upsert_elo_changes(dsn: str, store: dict, changed_ids, deleted_ids) -> dict:
    """증분 수집 결과를 Supabase에 반영한다.

    차원 테이블(cats/maps/players)은 작아서 매 실행 upsert하고,
    경기 테이블은 이번 실행에서 바뀐 ID만 upsert한다.
    """
    import psycopg

    changed_ids = {int(x) for x in changed_ids}
    deleted_ids = [int(x) for x in deleted_ids]

    categories = [(i, str(name)) for i, name in enumerate(store.get("cats", []))]
    maps = [(int(k), str(v)) for k, v in store.get("maps", {}).items()]
    players = [
        (int(k), str(v[0]), str(v[1]) if len(v) > 1 and v[1] else None)
        for k, v in store.get("players", {}).items()
    ]

    changed_rows = []
    for row in store.get("rows", []):
        if not row or int(row[0]) not in changed_ids:
            continue
        changed_rows.append((
            int(row[0]),
            _date_value(row[1]),
            int(row[2]) if row[2] not in (None, "") else None,
            int(row[3]) if row[3] not in (None, "") else None,
            int(row[4]) if row[4] not in (None, "") else None,
            int(row[5]),
        ))

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            if categories:
                cur.executemany(
                    """
                    insert into public.elo_categories (category_id, name)
                    values (%s, %s)
                    on conflict (category_id) do update set name = excluded.name
                    """,
                    categories,
                )

            if maps:
                cur.executemany(
                    """
                    insert into public.elo_maps (map_id, name)
                    values (%s, %s)
                    on conflict (map_id) do update set name = excluded.name
                    """,
                    maps,
                )

            if players:
                cur.executemany(
                    """
                    insert into public.elo_players (elo_id, name, race)
                    values (%s, %s, %s)
                    on conflict (elo_id) do update
                    set name = excluded.name,
                        race = excluded.race
                    """,
                    players,
                )

            if changed_rows:
                cur.executemany(
                    """
                    insert into public.elo_matches
                      (elo_match_id, match_date, winner_elo_id, loser_elo_id, map_id, category_id)
                    values (%s, %s, %s, %s, %s, %s)
                    on conflict (elo_match_id) do update
                    set match_date = excluded.match_date,
                        winner_elo_id = excluded.winner_elo_id,
                        loser_elo_id = excluded.loser_elo_id,
                        map_id = excluded.map_id,
                        category_id = excluded.category_id
                    """,
                    changed_rows,
                )

            if deleted_ids:
                cur.execute(
                    "delete from public.elo_matches where elo_match_id = any(%s)",
                    (deleted_ids,),
                )

    return {
        "categories": len(categories),
        "maps": len(maps),
        "players": len(players),
        "upserted_matches": len(changed_rows),
        "deleted_matches": len(deleted_ids),
    }

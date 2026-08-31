from sync_members import normalize_tier, flatten_players


class TestNormalizeTier:
    def test_strips_tier_suffix(self):
        assert normalize_tier("1티어") == "1"
        assert normalize_tier("4티어") == "4"

    def test_named_tier_passes_through(self):
        # "갓"/"킹" 등은 애초에 "티어" 접미사가 안 붙어있으므로 그대로 통과
        assert normalize_tier("갓") == "갓"
        assert normalize_tier("킹") == "킹"

    def test_none_passes_through(self):
        assert normalize_tier(None) is None

    def test_non_string_passes_through(self):
        assert normalize_tier(3) == 3


class TestFlattenPlayers:
    def test_flattens_tiers_into_single_list(self):
        api_data = {
            "tiers": [
                {"label": "갓", "players": [{"soop_id": "a"}, {"soop_id": "b"}]},
                {"label": "1티어", "players": [{"soop_id": "c"}]},
            ]
        }
        players = flatten_players(api_data)
        assert len(players) == 3
        ids = [p["soop_id"] for p in players]
        assert ids == ["a", "b", "c"]

    def test_attaches_normalized_tier_to_each_player(self):
        api_data = {"tiers": [{"label": "1티어", "players": [{"soop_id": "a"}]}]}
        players = flatten_players(api_data)
        assert players[0]["current_tier"] == "1"

    def test_empty_tiers_returns_empty_list(self):
        assert flatten_players({"tiers": []}) == []

    def test_missing_tiers_key_returns_empty_list(self):
        # API 구조가 예상과 다르게 와도(예: 빈 응답) 예외로 죽지 않아야 한다
        assert flatten_players({}) == []

    def test_tier_group_with_no_players_key(self):
        api_data = {"tiers": [{"label": "갓"}]}
        assert flatten_players(api_data) == []

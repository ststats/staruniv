"""
ststats 프로젝트의 CSR 페이지 생성 스크립트 (전면 개편본).

파이썬은 HTML 패널을 굽지 않고, 원본 JSON 데이터를 docs/data/daily/ 에 복사합니다.
모든 렌더링, 정렬, 달력 UI 기능은 페이지 내장 자바스크립트가 전적으로 담당합니다.
"""

import json
import colorsys
import hashlib
import shutil
from pathlib import Path
from PIL import Image

from _common import ROOT, safe_read_json, atomic_write_json
from jinja2 import Environment, FileSystemLoader

DATA_PATH = ROOT / "data" / "latest.json"
ARCHIVE_DIR = ROOT / "data" / "archive"
MEMBERS_PATH = ROOT / "data" / "members.json"
DOCS_DIR = ROOT / "docs"
SCRIPTS_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = SCRIPTS_DIR / "templates"
_jinja_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    keep_trailing_newline=True,
    trim_blocks=True,    # {% %} 태그 바로 뒤의 개행을 제거(안 그러면 {% if %}/{% include %}처럼
    lstrip_blocks=True,  # 아무것도 안 그리는 태그가 있던 줄이 그냥 빈 줄로 출력에 남는다)
)
DOCS_DATA_DIR = DOCS_DIR / "data" / "daily"
LOGOS_DIR = DOCS_DIR / "logos"
OUTPUT_INDEX = DOCS_DIR / "index.html"
OUTPUT_PROFILE_PATH = DOCS_DIR / "profile.html"
OUTPUT_TEAM_PATH = DOCS_DIR / "team.html"
OUTPUT_TEAMS_DIR = DOCS_DIR / "teams"  # 예전 방식(팀별 파일)의 잔재 정리용으로만 씀
# 팀 로고에서 대표 색상을 추출하는 건 이미지 픽셀을 전부 훑어야 해서(아래
# get_team_topbar_color 참고) 팀 수만큼 반복되면 은근히 무겁다. 로고는 자주
# 안 바뀌므로, 한 번 계산한 색상을 파일 내용 해시와 함께 캐싱해서 로고가
# 실제로 바뀐 팀만 다시 계산한다.
TEAM_LOGO_COLOR_CACHE_PATH = ROOT / "data" / "team_logo_colors_cache.json"

PLACEHOLDER_VALUES = {"체크", "todo", "TODO", "?", "미정", "확인", "확인필요", ""}
DEFAULT_TOPBAR_COLOR = "#4a5ce0"
NON_TEAM_TOPBAR_COLOR = "#8b8f99"

def get_team_topbar_color(team_name: str, cache: dict) -> str:
    """로고 파일에서 대표 색상을 추출한다. 파일 내용의 sha256 해시를 캐시
    키로 써서, 실제로 로고가 바뀐 팀만 다시 계산한다(수정 시각/mtime이
    아니라 내용 해시를 쓰는 이유: GitHub Actions의 checkout은 매번 저장소를
    새로 클론하면서, 파일 내용이 하나도 안 바뀌어도 mtime을 그 순간으로
    새로 찍어버린다 - mtime 기반 캐시였다면 매 실행마다 전부 무효화됐을
    것이다)."""
    logo_path = LOGOS_DIR / f"{team_name}.webp"
    if not logo_path.exists():
        return DEFAULT_TOPBAR_COLOR

    try:
        file_hash = hashlib.sha256(logo_path.read_bytes()).hexdigest()
    except OSError:
        return DEFAULT_TOPBAR_COLOR

    cached = cache.get(team_name)
    if cached and cached.get("hash") == file_hash:
        return cached["color"]

    color = DEFAULT_TOPBAR_COLOR
    try:
        img = Image.open(logo_path).convert("RGBA").resize((40, 40))
        buckets = {}
        for r, g, b, a in img.getdata():
            if a < 128 or (r > 235 and g > 235 and b > 235) or (r < 20 and g < 20 and b < 20): continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            key = (r // 20 * 20, g // 20 * 20, b // 20 * 20)
            bucket = buckets.setdefault(key, [0, 0.0])
            bucket[0] += 1
            bucket[1] += s
        if buckets:
            top_buckets = sorted(buckets.items(), key=lambda kv: -kv[1][0])[:6]
            best_key = max(top_buckets, key=lambda kv: kv[1][1] / kv[1][0])[0]
            color = f"#{best_key[0]:02x}{best_key[1]:02x}{best_key[2]:02x}"
    except Exception:
        pass

    cache[team_name] = {"hash": file_hash, "color": color}
    return color

def clean_value(v): return None if str(v).strip() in PLACEHOLDER_VALUES else v

def generate_html(title, target_team, is_profile, logo_prefix, static_info, team_colors, team_from_url=False):
    font_url = f"{logo_prefix}fonts/PretendardVariable.woff2"
    static_json = json.dumps(static_info, ensure_ascii=False)
    colors_json = json.dumps(team_colors, ensure_ascii=False)
    if team_from_url:
        target_team_js = "new URLSearchParams(window.location.search).get('team') || \"\""
    else:
        team_name_str = target_team if target_team else ""
        target_team_js = f'"{team_name_str}"'

    if is_profile:
        back_link_html = f'<a href="{logo_prefix}index.html" id="back-link" class="back-link">← 뒤로가기</a>'
        back_sep_html = '<span class="top-meta-sep" id="back-sep">·</span>'
    elif target_team:
        back_link_html = f'<a href="{logo_prefix}index.html" id="back-link" class="back-link">전체페이지</a>'
        back_sep_html = '<span class="top-meta-sep" id="back-sep">·</span>'
    else:
        back_link_html = ""
        back_sep_html = ""

    top_bar_html = f"""
  <div class="top-bar">
    <span class="month-select-group">
      <input type="date" id="date-picker" class="top-date-input" aria-label="날짜 선택">

      {'' if is_profile else '''
      <div class="select-wrapper">
          <select class="top-date-select" id="ms-metric-select">
              <option value='balloon'>별풍선</option>
              <option value='broadcast'>방송시간</option>
              <option value='viewer'>누적시청자</option>
              <option value='sponsor'>스폰판수</option>
          </select>
          <span class="nav-chevron">▾</span>
      </div>
      '''}
    </span>
    <span class="top-meta-group">
      {back_link_html}{back_sep_html}
      <span class="top-meta" id="top-meta-text"></span>
    </span>
  </div>
    """

    body_html = ""
    legend_html = ""
    if is_profile:
        body_html = f"""
  <div style="max-width:480px;margin:0 auto;">
  <div class="team-card" id="profile-card" style="display:none;">
    <div class="team-card-topbar" id="profile-topbar"></div>
    <div class="team-header">
      <div class="team-header-left">
        <img class="profile-photo-img" id="profile-photo" alt="">
        <span class="team-name" id="profile-nickname"></span>
      </div>
    </div>
    <div id="profile-live-embed" style="display:none;"></div>
    <div class="profile-info">
      <div class="profile-row"><span class="profile-row-label">성별</span><span class="profile-row-value" id="profile-gender"></span></div>
      <div class="profile-row"><span class="profile-row-label">생년월일</span><span class="profile-row-value" id="profile-birthdate"></span></div>
      <div class="profile-row"><span class="profile-row-label">소속</span><span class="profile-row-value" id="profile-team"></span></div>
      <div class="profile-row"><span class="profile-row-label">직책</span><span class="profile-row-value" id="profile-role"></span></div>
      <div class="profile-row"><span class="profile-row-label">종족</span><span class="profile-row-value" id="profile-race"></span></div>
      <div class="profile-row"><span class="profile-row-label">티어</span><span class="profile-row-value" id="profile-tier"></span></div>
      <div class="profile-row">
        <span class="profile-row-label">방송국</span>
        <a id="profile-station-link" href="#" target="_blank" rel="noopener">
          <img class="profile-station-icon" src="{logo_prefix}logos/숲로고.webp" alt="방송국 바로가기" onerror="this.style.display='none'">
        </a>
      </div>
    </div>
    <div class="team-footer">
      <div class="stat-card">
        <div class="stat-card-header no-icon"><span class="stat-label">별풍선</span></div>
        <div class="stat-value" id="profile-balloons"></div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header no-icon"><span class="stat-label">방송시간</span></div>
        <div class="stat-value" id="profile-broadcast"></div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header no-icon"><span class="stat-label">누적시청자</span></div>
        <div class="stat-value" id="profile-viewers"></div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header no-icon"><span class="stat-label">스폰전적</span></div>
        <div class="stat-value" id="profile-sponsor" style="color:#a4a8b2;font-size:12px;transition:opacity 0.3s ease;">-</div>
      </div>
    </div>
  </div>
  </div>
        """
    else:
        body_html = '<div id="grid-container"></div>'
        if not target_team:
            body_html += '<div id="fa-bar" class="fa-bar" style="display:none;"></div>'
        legend_html = """<div class="legend">
        <span><span class="sw" style="background:#d6e9fb;"></span>상위 1%</span>
        <span><span class="sw" style="background:#dcefdd;"></span>상위 5%</span>
        <span><span class="sw" style="background:#fbf3cf;"></span>상위 10%</span>
        <span id="role-legend-item"><span class="sw" style="background:#fadada;"></span>수장/전력외</span>
        <span>🎂 생일</span></div>"""


    include_mobile_css = not is_profile and not target_team
    template = _jinja_env.get_template("page.html.j2")
    return template.render(
        back_link_html=back_link_html,
        back_sep_html=back_sep_html,
        body_html=body_html,
        colors_json=colors_json,
        font_url=font_url,
        include_mobile_css=include_mobile_css,
        is_profile=is_profile,
        legend_html=legend_html,
        logo_prefix=logo_prefix,
        static_info=static_info,
        static_json=static_json,
        target_team=target_team,
        target_team_js=target_team_js,
        team_colors=team_colors,
        team_from_url=team_from_url,
        title=title,
        top_bar_html=top_bar_html,
    )

def _write_if_changed(dst_path: Path, content: str) -> None:
    if dst_path.exists():
        try:
            if dst_path.read_text(encoding="utf-8") == content:
                return
        except Exception:
            pass
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(content)

def _copy_if_changed(src_path: Path, dst_path: Path) -> None:
    if dst_path.exists() and dst_path.stat().st_size == src_path.stat().st_size:
        try:
            if dst_path.read_bytes() == src_path.read_bytes():
                return
        except Exception:
            pass
    shutil.copy(src_path, dst_path)

def main():
    DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    all_dates = []

    if DATA_PATH.exists():
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            latest = json.load(f)
            d_str = latest.get("date")
            if d_str:
                all_dates.append(d_str)
                _write_if_changed(DOCS_DATA_DIR / f"{d_str}.json", json.dumps(latest, ensure_ascii=False))

    if ARCHIVE_DIR.exists():
        for arch in ARCHIVE_DIR.glob("*.json"):
            if len(arch.stem) == 10:
                all_dates.append(arch.stem)
                _copy_if_changed(arch, DOCS_DATA_DIR / arch.name)

    all_dates = sorted(list(set(all_dates)), reverse=True)
    if not all_dates: return

    expected_files = {f"{d_str}.json" for d_str in all_dates}
    for existing in DOCS_DATA_DIR.glob("*.json"):
        if existing.name not in expected_files:
            existing.unlink()

    dates_js_content = "window.AVAILABLE_DATES = " + json.dumps(all_dates) + ";\n"
    _write_if_changed(DOCS_DIR / "data" / "dates.js", dates_js_content)

    with open(MEMBERS_PATH, "r", encoding="utf-8") as f:
        members_data = json.load(f).get("members", [])

    roster_ids = sorted({m.get("id") for m in members_data if m.get("id")})
    _write_if_changed(DOCS_DIR / "data" / "roster_ids.json", json.dumps(roster_ids, ensure_ascii=False))

    all_team_names = {
        m.get("team") for m in members_data
        if m.get("team") and m.get("team") not in ("FA", "휴면", "미분류")
    }

    static_info = {}
    for m in members_data:
        mid = m.get("id")
        if mid:
            static_info[mid] = {"gender": m.get("gender", "m"), "birthdate": clean_value(m.get("birthdate"))}

    team_color_cache = safe_read_json(TEAM_LOGO_COLOR_CACHE_PATH, default={})
    team_colors = {team: get_team_topbar_color(team, team_color_cache) for team in sorted(all_team_names)}
    atomic_write_json(TEAM_LOGO_COLOR_CACHE_PATH, team_color_cache)
    team_colors["FA"], team_colors["휴면"] = "#8b8f99", "#8b8f99"

    index_html = generate_html("스타대학", "", False, "", static_info, team_colors)
    OUTPUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    _write_if_changed(OUTPUT_INDEX, index_html)

    if OUTPUT_TEAMS_DIR.exists():
        shutil.rmtree(OUTPUT_TEAMS_DIR)

    if all_team_names:
        any_team = sorted(all_team_names)[0]
        team_html = generate_html("팀별 현황", any_team, False, "", static_info, team_colors,
                                   team_from_url=True)
        _write_if_changed(OUTPUT_TEAM_PATH, team_html)

    profile_html = generate_html("프로필", "", True, "", static_info, team_colors)
    _write_if_changed(OUTPUT_PROFILE_PATH, profile_html)

if __name__ == "__main__":
    main()
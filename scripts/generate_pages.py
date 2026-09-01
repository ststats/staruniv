"""
ststats 프로젝트의 CSR 페이지 생성 스크립트 (전면 개편본).

파이썬은 HTML 패널을 굽지 않고, 원본 JSON 데이터를 docs/data/daily/ 에 복사합니다.
모든 렌더링, 정렬, 달력 UI 기능은 페이지 내장 자바스크립트가 전적으로 담당합니다.
"""

import json
import colorsys
import shutil
from pathlib import Path
from PIL import Image

from _common import ROOT

DATA_PATH = ROOT / "data" / "latest.json"
ARCHIVE_DIR = ROOT / "data" / "archive"
MEMBERS_PATH = ROOT / "data" / "members.json"
DOCS_DIR = ROOT / "docs"
DOCS_DATA_DIR = DOCS_DIR / "data" / "daily"
LOGOS_DIR = DOCS_DIR / "logos"
OUTPUT_INDEX = DOCS_DIR / "index.html"
OUTPUT_PROFILE_PATH = DOCS_DIR / "profile.html"
OUTPUT_TEAM_PATH = DOCS_DIR / "team.html"
OUTPUT_TEAMS_DIR = DOCS_DIR / "teams"  # 예전 방식(팀별 파일)의 잔재 정리용으로만 씀

PLACEHOLDER_VALUES = {"체크", "todo", "TODO", "?", "미정", "확인", "확인필요", ""}
DEFAULT_TOPBAR_COLOR = "#4a5ce0"
NON_TEAM_TOPBAR_COLOR = "#8b8f99"

def get_team_topbar_color(team_name: str) -> str:
    logo_path = LOGOS_DIR / f"{team_name}.webp"
    if logo_path.exists():
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
                return f"#{best_key[0]:02x}{best_key[1]:02x}{best_key[2]:02x}"
        except Exception:
            pass
    return DEFAULT_TOPBAR_COLOR

PAGE_CSS = """
html { scrollbar-gutter: stable; }
* { box-sizing: border-box; }
body { font-family: 'Pretendard Variable', sans-serif; background: #f4f5f7; margin: 0; padding: 20px 10px; color: #1a1d29; }
.top-bar { max-width: 1080px; margin: 0 auto 16px; background: #fff; border-radius: 20px; padding: 16px 20px; min-height: 64px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; box-shadow: 0 1px 2px rgba(20,20,30,0.04), 0 4px 12px rgba(20,20,30,0.05); }
.month-select-group { display: inline-flex; align-items: center; gap: 6px; position: relative; }
.top-date-btn { background: transparent; border: none; font-size: 20px; font-weight: 800; color: #141821; cursor: pointer; padding: 2px 0; font-family: inherit; display:flex; align-items:center; gap: 6px; }
.top-date-btn:hover { color: #4a5ce0; }
.cal-popup { display: none; position: absolute; top: 100%; left: 0; margin-top: 8px; background: #fff; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); padding: 16px; z-index: 100; width: 260px; }
.cal-popup.show { display: block; }
.cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 700; }
.cal-nav-btn { background: none; border: none; font-size: 16px; cursor: pointer; color: #6b6f79; padding: 0 8px; }
.cal-nav-btn:hover { color: #141821; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
.cal-day-name { font-size: 11px; color: #a4a8b2; padding-bottom: 8px; font-weight: 600; }
.cal-date { font-size: 13px; font-weight: 600; padding: 8px 0; border-radius: 8px; cursor: pointer; color: #141821; }
.cal-date:hover { background: #f2f3f5; }
.cal-date.active { background: #4a5ce0; color: #fff; }
.cal-date.disabled { color: #d1d4d8; cursor: not-allowed; background: transparent; pointer-events: none; font-weight: 400; }

.select-wrapper { position: relative; display: inline-flex; align-items: center; gap: 6px; visibility: hidden; font-weight: 800; }
.select-wrapper.ready { visibility: visible; }
.top-date-select { font-size: 20px; font-weight: 800; color: #141821; border: none; background: transparent; cursor: pointer; font-family: inherit; padding: 2px 0; appearance: none; -webkit-appearance: none; -moz-appearance: none; }
.top-date-select:hover { color: #4a5ce0; }
.select-wrapper .nav-chevron { pointer-events: none; }
.nav-chevron { font-size: 14px; color: #c2c5cc; user-select: none; }

.back-link { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; color: #8a8d97; text-decoration: none; }
.back-link:hover { color: #4a5ce0; }
.top-meta-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.top-meta-sep { color: #c2c5cc; font-size: 10px; }
.top-meta { font-size: 10px; color: #a4a8b2; white-space: nowrap; }
.source-link { color: #4a5ce0; font-weight: 600; text-decoration: none; }
.source-link:hover { text-decoration: underline; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); align-items: start; gap: 16px; max-width: 1080px; margin: 0 auto; }
.grid.single-team { grid-template-columns: 1fr; max-width: 480px; }
.team-card { background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 1px 2px rgba(20,20,30,0.04), 0 8px 24px rgba(20,20,30,0.06); }
.team-card-topbar { height: 6px; background: #4a5ce0; }
.team-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f2f3f5; gap: 8px; flex-wrap: wrap; }
.team-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.team-link { color: inherit; text-decoration: none; }
.team-link:hover { text-decoration: underline; }
.team-logo { width: 28px; height: 28px; border-radius: 10px; object-fit: contain; flex-shrink: 0; }
.team-name { font-size: 16px; font-weight: 800; color: #141821; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.team-count { font-size: 10px; color: #a4a8b2; font-weight: 500; white-space: nowrap; }
.rank-change { display: inline-flex; align-items: center; line-height: 1; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; }
.rank-badge-slot { display: inline-flex; align-items: center; flex-shrink: 0; }
.rank-change.up { color: #0f8a4c; background: #e6f8ee; }
.rank-change.down { color: #c0392b; background: #fdeaea; }
.rank-change.same { color: #888; background: #eceef1; }
.rank-change.new { color: #4a5ce0; background: #e6e9fb; }

.member-columns { display: grid; grid-template-columns: 1fr 1fr; }
.member-col:first-child { border-right: 1px solid #f2f3f5; }
.member-col-label { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; color: #a4a8b2; padding: 10px 16px 8px; background: #fafbfc; }
.member-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; border-left: 4px solid transparent; min-height: 28px; position: relative; }
.member-row.tier1 { border-left-color: #4a5ce0; background: #f4f6fe; }
.member-row.tier5 { border-left-color: #1c9e6e; background: #effbf5; }
.member-row.tier10 { border-left-color: #d9a71b; background: #fdf6e0; }
.member-row.excluded { border-left-color: #d64545; background: #fdeaea; }
.member-name { font-size: 12px; color: #3a3d47; font-weight: 700; display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.member-name-link { display: flex; align-items: center; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
.member-name-link:hover { text-decoration: underline; }
.member-row.tier1 .member-name, .member-row.tier5 .member-name, .member-row.tier10 .member-name, .member-row.excluded .member-name { font-weight: 700; color: #1a1d29; }
.bday-mark { font-size: 8px; opacity: 0.75; flex-shrink: 0; }
.live-dot { display: none; position: absolute; left: 5px; top: 50%; transform: translateY(-50%); width: 4px; height: 4px; border-radius: 50%; background: #e53935; animation: live-dot-pulse 1.4s infinite; --live-dot-spread: 3px; }
.live-dot.is-live { display: block; }
@keyframes live-dot-pulse {
  0% { box-shadow: 0 0 0 0 rgba(229,57,53,0.55); }
  70% { box-shadow: 0 0 0 var(--live-dot-spread) rgba(229,57,53,0); }
  100% { box-shadow: 0 0 0 0 rgba(229,57,53,0); }
}
.member-value { font-size: 12px; color: #6b6f79; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; padding-left: 8px; }
.member-row.tier1 .member-value { color: #4a5ce0; font-weight: 700; }
.member-row.tier5 .member-value { color: #0f8a5c; font-weight: 700; }
.member-row.tier10 .member-value { color: #8a6d1a; font-weight: 700; }
.member-row.excluded .member-value { color: #1a1d29; font-weight: 700; }
.member-row.empty .member-name, .member-row.empty .member-value { color: #ccc; }

.team-footer { display: flex; gap: 6px; padding: 12px 10px 14px; background: #fafbfc; border-top: 1px solid #f2f3f5; }
.stat-card { flex: 1; text-align: center; padding: 14px 8px; border-radius: 16px; background: #fff; border: 1px solid #eef0f2; min-width: 0; }
.stat-card-header { display: flex; align-items: center; justify-content: center; gap: 4px; margin-bottom: 5px; margin-left: -6px; }
.stat-card-header.no-icon { margin-left: 0; }
.stat-label { font-size: 12px; color: #1a1d29; font-weight: 600; }
.stat-value { font-size: 12px; font-weight: 800; color: #1a1d29; font-variant-numeric: tabular-nums; }
.stat-icon { color: #1a1d29; flex-shrink: 0; }
.stat-card.female-avg { background: #eaf7f5; border: none; }
.stat-card.female-avg .stat-value { color: #085041; }
.stat-card.total-avg { background: #f1eefb; border: none; }
.stat-card.total-avg .stat-value { color: #26215c; }

.profile-photo-img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; background: #f2f3f5; flex-shrink: 0; }
#profile-live-embed { padding: 12px 16px; border-bottom: 1px solid #f2f3f5; }
.profile-live-row { display: flex; align-items: stretch; gap: 12px; }
.profile-live-thumb-link { display: block; position: relative; width: 176px; flex-shrink: 0; border-radius: 8px; overflow: hidden; }
.profile-live-thumb { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #1a1d29; }
.profile-live-badge { position: absolute; top: 4px; left: 4px; background: #e53935; color: #fff; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 3px; letter-spacing: 0.5px; }
.profile-live-info { display: grid; grid-template-rows: repeat(3, 1fr); align-items: center; min-width: 0; flex: 1; padding: 2px 0; }
.profile-live-title { font-size: 13px; font-weight: 700; color: #1a1d29; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.profile-live-viewer, .profile-live-elapsed { font-size: 12px; font-weight: 600; color: #6b6f79; text-align: right; }
.profile-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; font-size: 12px; border-bottom: 1px solid #f2f3f5; }
.profile-row-label { color: #6b6f79; font-weight: 600; }
.profile-row-value { font-weight: 700; color: #1a1d29; }
.profile-station-icon { width: 20px; height: 20px; border-radius: 5px; display: block; object-fit: contain; flex-shrink: 0; }

.legend { max-width: 1080px; margin: 16px auto 0; font-size: 10px; color: #6b6f79; text-align: center; }
.legend span { margin: 0 6px; }
.legend .sw { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }

.fa-bar { max-width: 1080px; margin: 16px auto 0; background: #fff; border-radius: 20px; padding: 16px 20px; box-shadow: 0 1px 2px rgba(20,20,30,0.04), 0 4px 12px rgba(20,20,30,0.05); }
.fa-bar-title { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; background: none; border: none; padding: 0; margin: 0; font-family: inherit; cursor: pointer; text-align: left; }
.fa-bar-chevron { font-size: 12px; color: #c2c5cc; flex-shrink: 0; transition: transform 0.2s ease; }
.fa-bar-label { font-size: 16px; font-weight: 800; color: #141821; }
.fa-bar-sub { font-size: 10px; color: #a4a8b2; font-weight: 500; }
.fa-bar-title:hover .fa-bar-label { color: #4a5ce0; }
.fa-bar-title:hover .fa-bar-chevron { color: #4a5ce0; }
.fa-bar-title.collapsed .fa-bar-chevron { transform: rotate(-90deg); }
.fa-bar-list { display: flex; flex-wrap: wrap; gap: 8px 10px; margin-top: 12px; }
.fa-bar-list.collapsed { display: none; }
.fa-bar-item a, .fa-bar-item span.fa-bar-static { display: flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; background: #fafbfc; border: 1px solid #f0f1f4; border-radius: 20px; padding: 4px 12px 4px 4px; transition: background 0.15s ease, border-color 0.15s ease; }
.fa-bar-item .live-dot { position: static; flex-shrink: 0; width: 4px; height: 4px; transform: none; left: auto; top: auto; }
.fa-bar-item .live-dot.is-live { display: inline-block; }
.fa-bar-item a:hover { background: #f4f6fe; border-color: #d8ddfa; }
.fa-bar-item a:hover .member-name { color: #4a5ce0; }
.fa-bar-photo { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; background: #f2f3f5; flex-shrink: 0; }
"""

MOBILE_CSS = """
@media (max-width: 600px) {
    body { padding: 10px 5px; }
    .top-bar { border-radius: 10px; padding: 8px 10px; gap: 4px; min-height: 32px; }
    .month-select-group { gap: 3px; }
    .top-date-btn { gap: 3px; }
    .select-wrapper { gap: 3px; }
    .top-date-btn, .top-date-select { font-size: 10px; }
    .cal-popup { width: 220px; left: -10px; }
    .nav-chevron { font-size: 7px; }
    .top-meta { font-size: 5px; white-space: normal; }
    .grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .team-card { border-radius: 10px; }
    .team-card-topbar { height: 3px; }
    .team-header { padding: 6px 8px; gap: 4px; }
    .team-header-left { gap: 5px; }
    .team-logo { width: 14px; height: 14px; border-radius: 5px; }
    .team-name { font-size: 8px; }
    .team-count { font-size: 5px; }
    .rank-change { font-size: 6px; padding: 2px 6px; border-radius: 10px; }
    .member-col-label { font-size: 6px; padding: 5px 8px 4px; }
    .member-col-label .col-label-text, .member-col-label .unit-label { font-size: 6px; }
    .member-row { padding: 4px 8px; min-height: 14px; border-left-width: 2px; }
    .live-dot { left: 2px; width: 2px; height: 2px; --live-dot-spread: 1.5px; }
    .member-name { font-size: 6px; gap: 3px; }
    .member-name-link { gap: 3px; }
    .bday-mark { font-size: 4px; }
    .member-value { font-size: 6px; padding-left: 4px; }
    .team-footer { padding: 6px 5px 7px; gap: 3px; }
    .stat-card { padding: 7px 4px; border-radius: 8px; }
    .stat-card-header { gap: 2px; margin-bottom: 2px; margin-left: -3px; }
    .stat-icon { width: 6px; height: 6px; }
    .stat-label { font-size: 6px; }
    .stat-value { font-size: 6px; }
    .legend { font-size: 5px; margin-top: 8px; }
    .fa-bar { border-radius: 10px; padding: 8px 10px; }
    .fa-bar-title { gap: 4px; min-height: 16px; }
    .fa-bar-label { font-size: 8px; }
    .fa-bar-sub { font-size: 5px; }
    .fa-bar-chevron { font-size: 6px; }
    .fa-bar-list { gap: 4px 5px; margin-top: 6px; }
    .fa-bar-item a, .fa-bar-item span.fa-bar-static { padding: 2px 6px 2px 2px; gap: 3px; }
    .fa-bar-photo { width: 11px; height: 11px; }
    .legend span { margin: 0 3px; }
    .legend .sw { width: 6px; height: 6px; margin-right: 2px; }
}
"""

def clean_value(v): return None if str(v).strip() in PLACEHOLDER_VALUES else v

def generate_html(title, target_team, is_profile, logo_prefix, static_info, team_colors, team_from_url=False):
    font_url = f"{logo_prefix}fonts/PretendardVariable.woff2"
    static_json = json.dumps(static_info, ensure_ascii=False)
    colors_json = json.dumps(team_colors, ensure_ascii=False)
    # AVAILABLE_DATES는 이 함수가 반환하는 큰 HTML 문자열 안에 직접 넣지 않는다
    # (아래 dates.js 관련 설명 참고) - 대신 main()이 별도의 작은 data/dates.js
    # 파일로 저장하고, 이 HTML은 그 파일을 <script src>로 동기 로드해서 쓴다.
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
      <button id="calendar-btn" class="top-date-btn"></button>
      <div id="cal-popup" class="cal-popup">
          <div class="cal-header">
              <button id="cal-prev" class="cal-nav-btn" aria-label="이전 달">◀</button>
              <span id="cal-title"></span>
              <button id="cal-next" class="cal-nav-btn" aria-label="다음 달">▶</button>
          </div>
          <div class="cal-grid">
              <div class="cal-day-name">일</div><div class="cal-day-name">월</div><div class="cal-day-name">화</div>
              <div class="cal-day-name">수</div><div class="cal-day-name">목</div><div class="cal-day-name">금</div><div class="cal-day-name">토</div>
          </div>
          <div id="cal-days" class="cal-grid"></div>
      </div>

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

    js_code = f"""<script src="{logo_prefix}data/dates.js"></script>
<script>
(function () {{
  const STATIC_INFO = {static_json};
  const TEAM_COLORS = {colors_json};
  // AVAILABLE_DATES는 여기서 선언하지 않는다 - 이 <script> 태그보다 앞서 동기
  // 로드되는 <script src="...data/dates.js">가 window.AVAILABLE_DATES를 이미
  // 채워놨고, 이 IIFE 스코프 체인이 그 전역 변수를 그대로 찾아 쓴다(즉 아래
  // 코드에서 쓰는 AVAILABLE_DATES는 사실 window.AVAILABLE_DATES다). 매일
  // 늘어나는 날짜 목록을 이 큰 HTML 안에 직접 박아넣으면 파일 전체가 매일
  // git에 다시 커밋되기 때문에, 작은 별도 파일로 뺐다 - 로딩 타이밍은 동기
  // <script src>라 전혀 안 바뀐다(fetch였다면 비동기라 아래 코드 전체를 다시
  // 짜야 했을 것).
  const TARGET_TEAM = {target_team_js};
  const LOGO_PREFIX = "{logo_prefix}";
  const IS_PROFILE = {'true' if is_profile else 'false'};

  const metricDefs = {{
      balloon: {{ field: 'balloons', label: '별풍선', unit: '별풍선', format: v => v ? v.toLocaleString('ko-KR') : '', excludeRoles: true, rankByFemale: false, source: '풍고', url: 'https://poonggo.com' }},
      broadcast: {{ field: 'broadcast_seconds', label: '방송시간', unit: '방송시간', format: formatTime, excludeRoles: true, rankByFemale: false, source: '풍고', url: 'https://poonggo.com' }},
      viewer: {{ field: 'cumulative_viewers', label: '누적시청자', unit: '누적시청자', format: v => v ? v.toLocaleString('ko-KR') : '', excludeRoles: true, rankByFemale: false, source: '풍고', url: 'https://poonggo.com' }},
      sponsor: {{ field: 'sponsor_games', label: '스폰판수', unit: '스폰판수', format: v => v ? v + '판' : '', excludeRoles: true, rankByFemale: true, source: 'Elo', url: 'https://eloboard.co.kr/' }}
  }};

  function soopPhotoUrl(id) {{
      return `https://profile.img.sooplive.com/LOGO/${{(id || '').substring(0, 2)}}/${{id}}/${{id}}.jpg`;
  }}

  // SOOP(구 아프리카TV)의 비공식 공개 엔드포인트로 방송중 여부를 직접 브라우저에서
  // 조회한다 - 공식 오픈 API는 파트너십 심사가 필요해서 이 프로젝트 규모에선 못
  // 쓴다. bjapi.afreecatv.com/api/{{id}}/station이 방송중이면 "broad" 필드가
  // 객체(broad_no/broad_title/current_sum_viewer 등)로, 아니면 null로 온다
  // (스트리밍 도구들이 실제로 이렇게 씀, 실제 응답으로 직접 확인함). 방송
  // 시작시각은 broad 안이 아니라 최상위 "station.broad_start"에 따로 있다.
  // 실패(CORS 차단/네트워크 오류 등)는 그냥 "라이브 아님(null)"으로 조용히
  // 넘어간다 - 페이지 나머지가 깨지면 안 되니까.
  //
  // 캐시에는 boolean이 아니라 {{broad, broadStart}} 객체(방송 중 아니면 null)를
  // 저장한다 - 점 표시(is-live 여부)는 그냥 truthy 체크만 하면 되지만, 프로필
  // 페이지는 여기서 방송 제목/시청자 수/방송번호(썸네일용)/시작시각까지 그대로
  // 꺼내 쓴다.
  const liveStatusCache = {{}};
  const LIVE_CHECK_CONCURRENCY = 12; // 한 번에 너무 많은 요청을 동시에 쏘지 않도록 제한

  async function checkIsLive(soopId) {{
      if (soopId in liveStatusCache) return liveStatusCache[soopId];
      let result = null;
      try {{
          const res = await fetch(`https://bjapi.afreecatv.com/api/${{soopId}}/station`);
          if (res.ok) {{
              const data = await res.json();
              if (data && data.broad) {{
                  result = {{
                      broad: data.broad,
                      broadStart: (data.station && data.station.broad_start) || null,
                  }};
              }}
          }}
      }} catch (e) {{
          result = null;
      }}
      liveStatusCache[soopId] = result;
      return result;
  }}

  function escapeHtml(s) {{
      return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }}

  async function refreshLiveDots() {{
      const dotEls = Array.from(document.querySelectorAll('.live-dot[data-live-id]'));
      if (dotEls.length === 0) return;

      // 같은 id가 여러 곳(FA바 + 팀카드 등)에 동시에 나올 수 있으니 id 기준으로만
      // 한 번씩 조회하고, 결과를 그 id를 쓰는 모든 점에 반영한다.
      const idToEls = {{}};
      dotEls.forEach(el => {{
          const id = el.dataset.liveId;
          (idToEls[id] = idToEls[id] || []).push(el);
      }});
      const ids = Object.keys(idToEls);

      let cursor = 0;
      async function worker() {{
          while (cursor < ids.length) {{
              const id = ids[cursor++];
              const isLive = await checkIsLive(id);
              if (isLive) idToEls[id].forEach(el => el.classList.add('is-live'));
          }}
      }}
      const workers = Array.from({{ length: Math.min(LIVE_CHECK_CONCURRENCY, ids.length) }}, worker);
      await Promise.all(workers);
  }}

  function withDerivedFields(data) {{
      // sponsor_games는 저장 단계에서 뺐다(sponsor_wins + sponsor_losses랑 100% 같은 값이라
      // 중복 저장할 이유가 없음) - 대신 각 날짜 데이터를 불러올 때마다 한 번씩 계산해서
      // 채워 넣는다. metricDefs.sponsor.field가 'sponsor_games'를 범용적으로 m[def.field]
      // 식으로 읽는 구조라, 여기서 한 번만 채워두면 나머지 코드는 그대로 써도 된다.
      (data.members || []).forEach(m => {{ m.sponsor_games = (m.sponsor_wins || 0) + (m.sponsor_losses || 0); }});
      return data;
  }}

  function formatTime(sec) {{
      if (!sec) return '';
      let h = Math.floor(sec / 3600);
      let m = Math.floor((sec % 3600) / 60);
      let s = Math.floor(sec % 60);
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }}

  function fitSelectWidth(selectEl) {{
      if (!selectEl || selectEl.selectedIndex < 0) return;
      const text = selectEl.options[selectEl.selectedIndex].text;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
      probe.style.font = getComputedStyle(selectEl).font;
      probe.textContent = text;
      document.body.appendChild(probe);
      selectEl.style.width = (probe.getBoundingClientRect().width + 2) + 'px';
      document.body.removeChild(probe);
  }}

  let currentDateStr = AVAILABLE_DATES[0];
  let currentMetric = "balloon";
  let fetchedData = {{}};

  const calBtn = document.getElementById('calendar-btn');
  const calPopup = document.getElementById('cal-popup');
  const calTitle = document.getElementById('cal-title');
  const calDays = document.getElementById('cal-days');
  let viewDate = new Date(currentDateStr);

  window.addEventListener('DOMContentLoaded', () => {{
      const params = new URLSearchParams(window.location.search);
      if (params.get('date') && AVAILABLE_DATES.includes(params.get('date'))) currentDateStr = params.get('date');
      if (params.get('metric') && metricDefs[params.get('metric')]) currentMetric = params.get('metric');

      const metricSel = document.getElementById('ms-metric-select');
      if(metricSel) {{
          metricSel.value = currentMetric;
          fitSelectWidth(metricSel);

          const wrapper = metricSel.closest('.select-wrapper');
          const revealSelect = () => {{
              fitSelectWidth(metricSel);
              if (wrapper) wrapper.classList.add('ready');
          }};

          if (document.fonts && document.fonts.ready) {{
              document.fonts.ready.then(revealSelect);
          }} else {{
              revealSelect();
          }}
      }}

      AVAILABLE_DATES.slice(1, 4).forEach(d => {{
          fetch(LOGO_PREFIX + 'data/daily/' + d + '.json').then(r=>r.json()).then(data => fetchedData[d] = withDerivedFields(data)).catch(()=>{{}});
      }});

      if (IS_PROFILE && document.referrer) {{
          // 프로필 페이지의 뒤로가기 목적지는 어디서 들어왔는지에 따라 갈린다:
          // 팀페이지에서 왔으면 그 팀페이지로, 그 외(전체페이지 등)엔 늘 전체페이지로.
          // 링크 자체는 (숨기지 않고) 항상 보인다 - 목적지만 갈릴 뿐이다.
          try {{
              const ref = new URL(document.referrer);
              if (ref.origin === window.location.origin && ref.pathname.endsWith('team.html')) {{
                  document.getElementById('back-link').href = document.referrer;
              }}
          }} catch(e) {{}}
      }}

      applyData();
  }});

  function applyData() {{
      const parts = currentDateStr.split('-');
      calBtn.innerHTML = parts[0].slice(-2) + '년 ' + parts[1] + '월 ' + parts[2] + '일 <span class="nav-chevron">▾</span>';

      if (TARGET_TEAM && !IS_PROFILE) {{
          document.getElementById('back-link').href = 'index.html?date=' + currentDateStr + '&metric=' + currentMetric;
      }}

      if (fetchedData[currentDateStr]) {{
          IS_PROFILE ? renderProfile(fetchedData[currentDateStr]) : renderDashboard(fetchedData[currentDateStr]);
      }} else {{
          if(!IS_PROFILE) document.getElementById('grid-container').innerHTML = '<div style="padding:40px;text-align:center;">불러오는 중...</div>';
          fetch(LOGO_PREFIX + 'data/daily/' + currentDateStr + '.json')
              .then(r => r.json())
              .then(data => {{
                  fetchedData[currentDateStr] = withDerivedFields(data);
                  IS_PROFILE ? renderProfile(data) : renderDashboard(data);
              }})
              .catch(e => {{
                  if(!IS_PROFILE) document.getElementById('grid-container').innerHTML = '<div style="padding:40px;text-align:center;color:#c23636;">오류 발생</div>';
              }});
      }}
  }}

  function findPrevMonthDate(dateStr) {{
      const [y, m] = dateStr.split('-').map(Number);
      const prevYM = (m === 1) ? `${{y - 1}}-12` : `${{y}}-${{String(m - 1).padStart(2, '0')}}`;
      const candidates = AVAILABLE_DATES.filter(d => d.startsWith(prevYM));
      if (candidates.length === 0) return null;
      return candidates.slice().sort().reverse()[0];
  }}

  function computeTeamAggregates(members, def) {{
      const teams = {{}};
      members.forEach(m => {{
          const t = m.team || '미분류';
          if (['FA', '휴면'].includes(t)) return;
          if (!teams[t]) teams[t] = [];
          teams[t].push(m);
      }});

      const result = [];
      for (const [tName, tMembers] of Object.entries(teams)) {{
          let mSum = 0, fSum = 0, mCount = 0, fCount = 0, tCount = 0;
          let males = [], females = [];

          tMembers.forEach(m => {{
              const sInfo = STATIC_INFO[m.id] || {{gender: 'm', birthdate: null}};
              const v = m[def.field] || 0;
              const counted = v !== 0 && !(def.excludeRoles && ['수장', '전력외'].includes(m.role));
              m._gender = sInfo.gender;
              m._bday = sInfo.birthdate;
              m._val = v;
              m._counted = counted;

              if (m._gender === 'm') {{ males.push(m); if (counted) {{ mSum += v; mCount++; tCount++; }} }}
              else {{ females.push(m); if (counted) {{ fSum += v; fCount++; tCount++; }} }}
          }});

          males.sort((a, b) => b._val - a._val);
          females.sort((a, b) => b._val - a._val);
          const fAvg = fCount > 0 ? Math.round(fSum / fCount) : 0;
          const tAvg = tCount > 0 ? Math.round((mSum + fSum) / tCount) : 0;

          result.push({{ name: tName, males, females, fAvg, tAvg, totalSum: mSum + fSum, rankVal: def.rankByFemale ? fAvg : tAvg }});
      }}
      return result;
  }}

  function computeTeamRanks(data, metricKey) {{
      const def = metricDefs[metricKey];
      const teamStats = computeTeamAggregates(data.members, def);
      teamStats.sort((a, b) => b.rankVal - a.rankVal);
      const ranks = {{}};
      teamStats.forEach((s, i) => {{ ranks[s.name] = i + 1; }});
      return ranks;
  }}

  async function attachRankBadges(teamStats, dateStr, metricKey) {{
      if (TARGET_TEAM) return;
      const currentRanks = {{}};
      teamStats.forEach((s, i) => {{ currentRanks[s.name] = i + 1; }});

      const prevDate = findPrevMonthDate(dateStr);
      if (!prevDate) return;

      let prevData = fetchedData[prevDate];
      if (!prevData) {{
          try {{
              const res = await fetch(LOGO_PREFIX + 'data/daily/' + prevDate + '.json');
              prevData = withDerivedFields(await res.json());
              fetchedData[prevDate] = prevData;
          }} catch (e) {{ return; }}
      }}

      const prevRanks = computeTeamRanks(prevData, metricKey);
      teamStats.forEach(s => {{
          const slot = document.querySelector('.rank-badge-slot[data-team="' + CSS.escape(s.name) + '"]');
          if (!slot) return;
          const curRank = currentRanks[s.name];
          if (!(s.name in prevRanks)) {{
              slot.innerHTML = '<span class="rank-change new">NEW</span>';
          }} else {{
              const prevRank = prevRanks[s.name];
              if (curRank < prevRank) slot.innerHTML = '<span class="rank-change up">▲' + (prevRank - curRank) + '</span>';
              else if (curRank > prevRank) slot.innerHTML = '<span class="rank-change down">▼' + (curRank - prevRank) + '</span>';
              else slot.innerHTML = '<span class="rank-change same">-</span>';
          }}
      }});
  }}

  const TIER_ORDER = ['갓', '킹', '잭', '조커', '스페이드', '0', '1', '2', '3', '4', '5', '6', '7', '8', '유스'];

  let faBarCollapsed = true;

  function renderFaBar(data) {{
      if (TARGET_TEAM) return;
      const faBar = document.getElementById('fa-bar');
      if (!faBar) return;

      const faMembers = data.members.filter(m => m.team === 'FA').slice();
      if (faMembers.length === 0) {{ faBar.style.display = 'none'; faBar.innerHTML = ''; return; }}

      faMembers.sort((a, b) => {{
          const ai = TIER_ORDER.indexOf(a.tier);
          const bi = TIER_ORDER.indexOf(b.tier);
          return (ai === -1 ? TIER_ORDER.length : ai) - (bi === -1 ? TIER_ORDER.length : bi);
      }});

      const itemsHtml = faMembers.map(m => {{
          const photoUrl = soopPhotoUrl(m.id);
          const photoImg = `<img class="fa-bar-photo" src="${{photoUrl}}" alt="" onerror="this.style.visibility='hidden'">`;
          const liveDot = m.id ? `<span class="live-dot" data-live-id="${{m.id}}"></span>` : '';
          const inner = `${{photoImg}}${{liveDot}}<span class="member-name">${{m.nickname}}</span>`;
          return m.id
              ? `<div class="fa-bar-item"><a href="${{LOGO_PREFIX}}profile.html?id=${{m.id}}&date=${{currentDateStr}}">${{inner}}</a></div>`
              : `<div class="fa-bar-item"><span class="fa-bar-static">${{inner}}</span></div>`;
      }}).join('');

      const collapsedClass = faBarCollapsed ? ' collapsed' : '';
      faBar.innerHTML = `<button type="button" class="fa-bar-title${{collapsedClass}}" id="fa-bar-toggle"><span class="fa-bar-chevron">▾</span><span class="fa-bar-label">FA</span><span class="fa-bar-sub">${{faMembers.length}}명</span></button><div class="fa-bar-list${{collapsedClass}}" id="fa-bar-list">${{itemsHtml}}</div>`;
      faBar.style.display = '';

      document.getElementById('fa-bar-toggle').addEventListener('click', () => {{
          faBarCollapsed = !faBarCollapsed;
          document.getElementById('fa-bar-toggle').classList.toggle('collapsed', faBarCollapsed);
          document.getElementById('fa-bar-list').classList.toggle('collapsed', faBarCollapsed);
      }});
  }}

  function renderDashboard(data) {{
      const def = metricDefs[currentMetric];
      const monthNum = parseInt(currentDateStr.split('-')[1], 10);
      const upd = (currentMetric === 'sponsor' && data.sponsor_updated_at) ? data.sponsor_updated_at : data.updated_at;

      const validTeams = new Set(data.members.map(m=>m.team).filter(t => t && t !== 'FA' && t !== '휴면'));
      const inquiryHtml = TARGET_TEAM ? '' : ' <span style="color:#c2c5cc;">·</span> <a href="https://ygosu.com/board/pan_prison" target="_blank" class="source-link">문의</a>';
      document.getElementById('top-meta-text').innerHTML = validTeams.size + '팀 · ' +
        data.members.filter(m => m.team && m.team !== 'FA' && m.team !== '휴면').length +
        '명 · 업데이트 ' + upd + ' · 출처: <a href="'+def.url+'" target="_blank" class="source-link">'+def.source+'</a>' + inquiryHtml;

      const roleLegend = document.getElementById('role-legend-item');
      if(roleLegend) roleLegend.style.display = def.excludeRoles ? '' : 'none';

      const tiers = {{}};
      const pool = data.members.filter(m => {{
          const v = m[def.field] || 0;
          if (v === 0) return false;
          if (def.excludeRoles && ['수장', '전력외'].includes(m.role)) return false;
          if (['FA', '휴면'].includes(m.team)) return false;
          return true;
      }}).sort((a,b) => (b[def.field] || 0) - (a[def.field] || 0));

      const n = pool.length;
      const t1 = Math.max(1, Math.round(n * 0.01));
      const t5 = Math.max(1, Math.round(n * 0.05));
      const t10 = Math.max(1, Math.round(n * 0.10));
      pool.forEach((m, i) => {{
          if (i < t1) tiers[m.nickname + '|' + m.team] = 'tier1';
          else if (i < t5) tiers[m.nickname + '|' + m.team] = 'tier5';
          else if (i < t10) tiers[m.nickname + '|' + m.team] = 'tier10';
      }});

      const teamStats = computeTeamAggregates(data.members, def);
      teamStats.sort((a, b) => b.rankVal - a.rankVal);

      let html = '';
      const targetTeamStats = TARGET_TEAM ? teamStats.filter(t => t.name === TARGET_TEAM) : teamStats;

      if (TARGET_TEAM && targetTeamStats.length === 0) {{
          html = '<div class="team-card" style="padding:24px;text-align:center;color:#999;font-size:13px;">이 날짜에는 팀 정보가 없습니다.</div>';
      }} else {{
          targetTeamStats.forEach(ts => {{
              const logoHtml = `<img src="${{LOGO_PREFIX}}logos/${{ts.name}}.webp" class="team-logo" alt="" onerror="this.style.display='none'">`;
              const topColor = TEAM_COLORS[ts.name] || '#4a5ce0';
              const countHtml = `<span class="team-count">총 ${{ts.males.length + ts.females.length}}명 · 남 ${{ts.males.length}} · 여 ${{ts.females.length}}</span>`;
              const headerLeft = TARGET_TEAM ? `<div class="team-header-left">${{logoHtml}}<span class="team-name">${{ts.name}}</span>${{countHtml}}</div>`
                  : `<div class="team-header-left">${{logoHtml}}<a class="team-link team-name" href="team.html?team=${{encodeURIComponent(ts.name)}}&date=${{currentDateStr}}&metric=${{currentMetric}}">${{ts.name}}</a>${{countHtml}}</div>`;
              const rankSlot = TARGET_TEAM ? '' : `<span class="rank-badge-slot" data-team="${{ts.name}}"></span>`;

              const makeRows = (list, padLen) => {{
                  let rHtml = list.map(m => {{
                      let cClass = [];
                      if (!m._counted && m._val !== 0) cClass.push('excluded');
                      const tier = tiers[m.nickname + '|' + m.team];
                      if (tier) cClass.push(tier);

                      const isBday = m._bday && parseInt(m._bday.split('-')[1], 10) === monthNum;
                      const liveDot = m.id ? `<span class="live-dot" data-live-id="${{m.id}}"></span>` : '';
                      const bdayMark = isBday ? '<span class="bday-mark">🎂</span>' : '';
                      const nameContent = m.id
                          ? `${{liveDot}}<a class="member-name-link" href="${{LOGO_PREFIX}}profile.html?id=${{m.id}}&date=${{currentDateStr}}">${{m.nickname}}</a>${{bdayMark}}`
                          : liveDot + m.nickname + bdayMark;
                      return `<div class="member-row ${{cClass.join(' ')}}"><span class="member-name">${{nameContent}}</span><span class="member-value">${{def.format(m._val)}}</span></div>`;
                  }}).join('');

                  for(let i=0; i < padLen - list.length; i++) rHtml += `<div class="member-row empty"><span class="member-name"></span><span class="member-value"></span></div>`;
                  return rHtml;
              }};

              const maxLen = Math.max(ts.males.length, ts.females.length);
              html += `
              <div class="team-card">
                <div class="team-card-topbar" style="background:${{topColor}};"></div>
                <div class="team-header">${{headerLeft}}${{rankSlot}}</div>
                <div class="member-columns">
                  <div class="member-col"><div class="member-col-label"><span class="col-label-text">남자</span><span class="unit-label">${{def.unit}}</span></div>${{makeRows(ts.males, maxLen)}}</div>
                  <div class="member-col"><div class="member-col-label"><span class="col-label-text">여자</span><span class="unit-label">${{def.unit}}</span></div>${{makeRows(ts.females, maxLen)}}</div>
                </div>
                <div class="team-footer">
                  <div class="stat-card"><div class="stat-card-header"><svg class="stat-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 11v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/></svg><span class="stat-label">전체 합계</span></div><div class="stat-value">${{def.format(ts.totalSum)}}</div></div>
                  <div class="stat-card female-avg"><div class="stat-card-header"><svg class="stat-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 18h6"/></svg><span class="stat-label">여자 평균</span></div><div class="stat-value">${{def.format(ts.fAvg)}}</div></div>
                  <div class="stat-card total-avg"><div class="stat-card-header"><svg class="stat-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg><span class="stat-label">전체 평균</span></div><div class="stat-value">${{def.format(ts.tAvg)}}</div></div>
                </div>
              </div>`;
          }});
      }}
      document.getElementById('grid-container').innerHTML = `<div class="grid ${{TARGET_TEAM ? 'single-team' : ''}}">${{html}}</div>`;
      attachRankBadges(teamStats, currentDateStr, currentMetric);
      renderFaBar(data);
      if (TARGET_TEAM) document.title = TARGET_TEAM + ' 현황';
      refreshLiveDots();
  }}

  function renderProfile(data) {{
      const tid = new URLSearchParams(window.location.search).get('id');
      const member = data.members.find(m => m.id === tid);
      if (!member) {{
          document.getElementById('profile-card').style.display = 'none';
          document.getElementById('top-meta-text').innerHTML = '데이터 없음';
          return;
      }}

      document.getElementById('profile-topbar').style.background = TEAM_COLORS[member.team] || '#4a5ce0';
      document.getElementById('profile-nickname').textContent = member.nickname || '';
      document.getElementById('profile-card').style.display = '';

      const photoImg = document.getElementById('profile-photo');
      photoImg.onerror = function() {{ this.style.visibility = 'hidden'; }};
      photoImg.onload = function() {{ this.style.visibility = ''; }};
      photoImg.src = soopPhotoUrl(tid);

      // 방송 중이면 그 사람 프로필에 실제 재생 화면 대신 정지 썸네일(왼쪽) +
      // 방송정보(오른쪽: 제목/시청자수/경과시간/시작시각)를 가로로 배치해서 컴팩트하게
      // 보여준다. 썸네일 URL은 liveimg.sooplive.co.kr/m/{{broad_no}} 패턴이고, 클릭하면
      // 실제 방송(play.sooplive.co.kr/{{아이디}})으로 새 탭에서 이동한다. 방송 시작시각은
      // broad 안이 아니라 station.broad_start에 있어서 checkIsLive가 따로 같이 돌려준다.
      // checkIsLive는 위쪽 라이브 점 표시 기능이랑 똑같은 함수를 그대로 재사용한다 -
      // 같은 API/캐시를 공유.
      const liveEmbedEl = document.getElementById('profile-live-embed');
      if (tid) {{
          checkIsLive(tid).then(result => {{
              if (result) {{
                  const {{ broad, broadStart }} = result;
                  const viewerText = broad.current_sum_viewer != null
                      ? broad.current_sum_viewer.toLocaleString('ko-KR') + '명 시청 중' : '';
                  let elapsedText = '';
                  if (broadStart) {{
                      const startDate = new Date(broadStart.replace(' ', 'T'));
                      if (!isNaN(startDate.getTime())) {{
                          const elapsedSec = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 1000));
                          const eh = Math.floor(elapsedSec / 3600);
                          const em = Math.floor((elapsedSec % 3600) / 60);
                          elapsedText = (eh > 0 ? `${{eh}}시간 ${{em}}분` : `${{em}}분`) + ' 방송중';
                      }}
                  }}
                  liveEmbedEl.innerHTML = `
                    <div class="profile-live-row">
                      <a class="profile-live-thumb-link" href="https://play.sooplive.co.kr/${{tid}}" target="_blank" rel="noopener">
                        <img class="profile-live-thumb" src="https://liveimg.sooplive.co.kr/m/${{broad.broad_no}}" alt="방송 화면">
                        <span class="profile-live-badge">LIVE</span>
                      </a>
                      <div class="profile-live-info">
                        <span class="profile-live-title">${{escapeHtml(broad.broad_title)}}</span>
                        <span class="profile-live-viewer">${{escapeHtml(viewerText)}}</span>
                        <span class="profile-live-elapsed">${{escapeHtml(elapsedText)}}</span>
                      </div>
                    </div>`;
                  liveEmbedEl.style.display = '';
              }} else {{
                  liveEmbedEl.innerHTML = '';
                  liveEmbedEl.style.display = 'none';
              }}
          }});
      }}

      const sInfo = STATIC_INFO[tid] || {{gender:'m', birthdate:'-'}};
      document.getElementById('profile-gender').textContent = sInfo.gender === 'f' ? '여' : '남';
      document.getElementById('profile-birthdate').textContent = sInfo.birthdate || '-';
      document.getElementById('profile-team').textContent = member.team || '-';
      document.getElementById('profile-role').textContent = member.role || '-';
      document.getElementById('profile-race').textContent = member.race || '-';
      document.getElementById('profile-tier').textContent = member.tier || '-';
      document.getElementById('profile-station-link').href = `https://www.sooplive.com/station/${{tid}}`;

      const fmt = n => n ? n.toLocaleString('ko-KR') : '-';
      document.getElementById('profile-balloons').textContent = fmt(member.balloons);
      document.getElementById('profile-viewers').textContent = fmt(member.cumulative_viewers);
      document.getElementById('profile-broadcast').textContent = formatTime(member.broadcast_seconds) || '-';

      const sponsorEl = document.getElementById('profile-sponsor');
      if (window.__sponsorToggleTimer) clearInterval(window.__sponsorToggleTimer);
      const sGames = member.sponsor_games || 0;
      if (sGames > 0) {{
          const sWins = member.sponsor_wins || 0;
          const sLosses = member.sponsor_losses || 0;
          const sRate = Math.round((sWins/sGames)*100);
          const texts = [sWins + '승 ' + sLosses + '패', sRate + '%'];
          let idx = 0;
          sponsorEl.textContent = texts[0];
          sponsorEl.style.color = '';
          window.__sponsorToggleTimer = setInterval(() => {{
              sponsorEl.style.opacity = '0';
              setTimeout(() => {{
                  idx = 1 - idx;
                  sponsorEl.textContent = texts[idx];
                  sponsorEl.style.opacity = '1';
              }}, 300);
          }}, 2000);
      }} else {{
          sponsorEl.textContent = '-';
          sponsorEl.style.color = '#a4a8b2';
      }}

      document.title = (member.nickname || tid) + ' 프로필';
      document.getElementById('top-meta-text').innerHTML = '업데이트 ' + data.updated_at + ' · 출처: <a href="https://poonggo.com" target="_blank" class="source-link">풍고</a>, <a href="https://eloboard.co.kr/" target="_blank" class="source-link">Elo</a>';
  }}

  function renderCalendar() {{
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      document.getElementById('cal-title').textContent = y + '년 ' + (m+1) + '월';
      calDays.innerHTML = '';

      const firstDay = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m+1, 0).getDate();
      for(let i=0; i<firstDay; i++) calDays.appendChild(document.createElement('div'));

      for(let d=1; d<=daysInMonth; d++) {{
          const dateStr = y + '-' + String(m+1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const el = document.createElement('div');
          el.className = 'cal-date';
          el.textContent = d;
          el.setAttribute('aria-label', y + '년 ' + (m+1) + '월 ' + d + '일');

          if (AVAILABLE_DATES.includes(dateStr)) {{
              if (dateStr === currentDateStr) {{
                  el.classList.add('active');
                  el.setAttribute('aria-current', 'date');
              }}
              el.setAttribute('role', 'button');
              el.setAttribute('tabindex', '0');
              const selectDate = function() {{
                  currentDateStr = dateStr;
                  calPopup.classList.remove('show');
                  applyData();
              }};
              el.onclick = selectDate;
              el.onkeydown = function(e) {{
                  if (e.key === 'Enter' || e.key === ' ') {{ e.preventDefault(); selectDate(); }}
              }};
          }} else {{
              el.classList.add('disabled');
              el.setAttribute('aria-disabled', 'true');
          }}
          calDays.appendChild(el);
      }}
  }}

  document.getElementById('cal-prev').onclick = function() {{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderCalendar(); }};
  document.getElementById('cal-next').onclick = function() {{ viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderCalendar(); }};

  calBtn.onclick = function(e) {{
      e.stopPropagation();
      viewDate = new Date(currentDateStr);
      renderCalendar();
      calPopup.classList.toggle('show');
  }};

  document.addEventListener('click', function(e) {{
      if (!calBtn.contains(e.target) && !calPopup.contains(e.target)) calPopup.classList.remove('show');
  }});

  const metricSel = document.getElementById('ms-metric-select');
  if(metricSel) {{
      metricSel.addEventListener('change', function() {{
          currentMetric = metricSel.value;
          fitSelectWidth(metricSel);
          applyData();
      }});
  }}
}})();
</script>"""

    include_mobile_css = not is_profile and not target_team
    mobile_css_block = MOBILE_CSS if include_mobile_css else ""
    return f"""<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{title}</title><link rel="icon" type="image/webp" href="{logo_prefix}logos/파비콘.webp"><link rel="preload" href="{font_url}" as="font" type="font/woff2" crossorigin><style>@font-face {{ font-family: 'Pretendard Variable'; font-weight: 45 920; font-style: normal; font-display: block; src: url('{font_url}') format('woff2-variations'); }} {PAGE_CSS} {mobile_css_block}</style></head><body>{top_bar_html}{body_html}{legend_html}{js_code}</body></html>"""

def _write_if_changed(dst_path: Path, content: str) -> None:
    """content가 이미 dst_path에 똑같이 들어있으면 아무것도 안 쓰고 건너뛴다.
    한 번 확정된 과거 날짜 파일은 거의 다시 안 바뀌므로(소급 정정/월 확정 등
    드문 경우 제외), 매번 전부 다시 쓰는 것보다 디스크 I/O가 훨씬 줄어든다."""
    if dst_path.exists():
        try:
            if dst_path.read_text(encoding="utf-8") == content:
                return
        except Exception:
            pass  # 기존 파일을 못 읽었으면 그냥 새로 씀
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(content)


def _copy_if_changed(src_path: Path, dst_path: Path) -> None:
    """src_path 내용이 dst_path와 이미 동일하면(크기부터 다르면 바로 판단, 크기가
    같으면 실제 내용까지 비교) 복사를 건너뛴다."""
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

    # docs/data/daily/에는 있는데 이제 원본(data/latest.json + data/archive/*.json)엔
    # 없는 파일(고아 파일)은 지운다 - 통째로 지우고 새로 만들던 예전 방식이 자동으로
    # 해주던 정리를, 이제는 명시적으로 해줘야 한다.
    expected_files = {f"{d_str}.json" for d_str in all_dates}
    for existing in DOCS_DATA_DIR.glob("*.json"):
        if existing.name not in expected_files:
            existing.unlink()

    # AVAILABLE_DATES는 매일 늘어나므로 index.html/team.html/profile.html
    # 본문에는 더 이상 안 박아넣는다(생성부의 generate_html/js_code 참고) -
    # 이 작은 파일 하나만 매일 바뀌고, 세 HTML은 실제 템플릿/로고색/로스터가
    # 바뀐 날에만 다시 쓰인다. window.AVAILABLE_DATES로 선언해서, HTML의
    # <script src="...data/dates.js">가 메인 <script>보다 앞서 동기 로드되면
    # 곧바로 전역 변수로 쓸 수 있다.
    dates_js_content = "window.AVAILABLE_DATES = " + json.dumps(all_dates) + ";\n"
    _write_if_changed(DOCS_DIR / "data" / "dates.js", dates_js_content)

    with open(MEMBERS_PATH, "r", encoding="utf-8") as f:
        members_data = json.load(f).get("members", [])

    # 팀 이름 목록은 과거 아카이브를 전부 뒤지지 않고 members.json(현재 로스터)
    # 하나만 보고 뽑는다 - 예전엔 all_dates 전체(수백~수천 개로 계속 불어나는
    # 아카이브 파일)를 매번 읽고 파싱했는데, 사실 팀 이름은 members.json에도
    # 똑같이 다 있다. 클라이언트 JS(TEAM_COLORS[team] || 기본색)에 이미 폴백이
    # 있어서, 지금은 없어진 옛날 팀 이름이 여기 안 잡혀도 과거 날짜를 볼 때
    # 기본색으로만 대체될 뿐 깨지지 않는다 - 그 정도 트레이드오프로 매일 실행
    # 시간이 아카이브 개수에 비례해서 계속 늘어나는 걸 막는다.
    all_team_names = {
        m.get("team") for m in members_data
        if m.get("team") and m.get("team") not in ("FA", "휴면", "미분류")
    }

    static_info = {}
    for m in members_data:
        mid = m.get("id")
        if mid:
            static_info[mid] = {"gender": m.get("gender", "m"), "birthdate": clean_value(m.get("birthdate"))}

    team_colors = {team: get_team_topbar_color(team) for team in sorted(all_team_names)}
    team_colors["FA"], team_colors["휴면"] = "#8b8f99", "#8b8f99"

    index_html = generate_html("스타대학", "", False, "", static_info, team_colors)
    OUTPUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    _write_if_changed(OUTPUT_INDEX, index_html)

    if OUTPUT_TEAMS_DIR.exists():
        shutil.rmtree(OUTPUT_TEAMS_DIR)

    if all_team_names:
        any_team = sorted(all_team_names)[0]  # set 순회 순서는 프로세스마다 달라지므로
        # (해시 랜덤화) 매번 같은 팀이 뽑히도록 정렬해서 고른다 - team_from_url=True라
        # 실제 렌더링엔 어느 팀이 뽑히는지 자체는 영향 없지만, 그래도 재현 가능하게.
        team_html = generate_html("팀별 현황", any_team, False, "", static_info, team_colors,
                                   team_from_url=True)
        _write_if_changed(OUTPUT_TEAM_PATH, team_html)

    profile_html = generate_html("프로필", "", True, "", static_info, team_colors)
    _write_if_changed(OUTPUT_PROFILE_PATH, profile_html)

if __name__ == "__main__":
    main()

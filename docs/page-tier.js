/* ==========================================================================
   staruniv - page-tier.js (26번: 첫 진입 시 '방송중' 기본 활성화)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const filterBtns = document.querySelectorAll('.tier-filter-bar .filter-btn');
  let currentFilter = 'onair'; // 26번: 방송중이 기본

  function applyFilter(filter) {
    filterBtns.forEach(btn => {
      if (btn.dataset.filter === filter) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    });

    const tierCards = document.querySelectorAll('.tier-card');
    tierCards.forEach(card => {
      const isLive = card.dataset.live === 'true';
      const race = card.dataset.race;

      if (filter === 'onair') {
        card.style.display = isLive ? 'flex' : 'none';
      } else if (filter === 'all') {
        card.style.display = 'flex';
      } else {
        card.style.display = (race === filter) ? 'flex' : 'none';
      }
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      applyFilter(currentFilter);
    });
  });

  // 초기 로드 시 'onair' 필터 자동 실행
  applyFilter('onair');
});

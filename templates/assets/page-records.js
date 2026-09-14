document.addEventListener('DOMContentLoaded', () => {
  const filterItems = document.querySelectorAll('#crewFilterList .filter-item');
  filterItems.forEach(item => {
    item.addEventListener('click', () => {
      filterItems.forEach(i => i.classList.remove('is-active'));
      item.classList.add('is-active');
    });
  });
});

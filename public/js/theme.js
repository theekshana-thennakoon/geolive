/**
 * GeoLive Pro - Theme Management
 * Default: Light Mode
 * User can switch to Dark Mode at any time; preference is persisted in localStorage.
 */
(function() {
  // Apply saved theme immediately before DOM renders to prevent flash
  const savedTheme = localStorage.getItem('geolive_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

function initTheme() {
  const currentTheme = localStorage.getItem('geolive_theme') || 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons(currentTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('geolive_theme', newTheme);
  updateThemeIcons(newTheme);
}

function updateThemeIcons(theme) {
  const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
  toggleBtns.forEach(btn => {
    if (theme === 'dark') {
      btn.innerHTML = '<i class="fa-solid fa-sun" style="color: #f59e0b;"></i>';
      btn.setAttribute('title', 'Switch to Light Mode');
      btn.setAttribute('aria-label', 'Switch to Light Mode');
    } else {
      btn.innerHTML = '<i class="fa-solid fa-moon" style="color: #6366f1;"></i>';
      btn.setAttribute('title', 'Switch to Dark Mode');
      btn.setAttribute('aria-label', 'Switch to Dark Mode');
    }
  });
}

// Initialize as soon as DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}

/**
 * SmartNotes - Main Application Logic (public/js/main.js)
 * User session management, theme toggle, toast notifications,
 * mobile drawer navigation, and modal delete actions.
 */

// =============================================================================
// 1. Session & Auth Verification
// =============================================================================

async function checkAuthStatus() {
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const publicPages = ['index.html', 'login.html', 'register.html', ''];

  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem('smartnotes_user', JSON.stringify(data.user));
        updateUserUI(data.user);
      }
    } else if (!publicPages.includes(currentPath)) {
      // If not logged in on protected page, redirect to login
      console.warn('Session not found, redirecting to login.html');
      window.location.href = 'login.html';
    }
  } catch (err) {
    // If backend is reachable or local fallback
    const cachedUser = localStorage.getItem('smartnotes_user');
    if (cachedUser) {
      try { updateUserUI(JSON.parse(cachedUser)); } catch (e) {}
    }
  }
}

function updateUserUI(user) {
  if (!user) return;
  const nameDisplays = document.querySelectorAll('.student-name-display');
  const emailDisplays = document.querySelectorAll('.student-email-display');
  const avatarDisplays = document.querySelectorAll('.student-avatar-initials');

  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    : 'ST';

  nameDisplays.forEach(el => el.textContent = user.name || 'Alex Student');
  emailDisplays.forEach(el => el.textContent = user.email || 'student@smartnotes.demo');
  avatarDisplays.forEach(el => el.textContent = initials);
}

// =============================================================================
// 2. Global Logout Handler
// =============================================================================

async function logoutUser() {
  showToast('Signing out...', 'info');
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.warn('Logout API error:', e);
  }
  localStorage.removeItem('smartnotes_user');
  setTimeout(() => {
    window.location.href = 'login.html';
  }, 600);
}

// =============================================================================
// 3. Theme Toggle (Light / Dark)
// =============================================================================

function initTheme() {
  const savedTheme = localStorage.getItem('smartnotes_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('smartnotes_theme', newTheme);
  updateThemeIcon(newTheme);
  showToast(`Switched to ${newTheme} mode`, 'info');
}

function updateThemeIcon(theme) {
  const themeToggles = document.querySelectorAll('.theme-toggle-btn');
  themeToggles.forEach(btn => {
    const icon = btn.querySelector('i');
    if (icon) {
      if (theme === 'dark') {
        icon.className = 'fa-solid fa-sun';
      } else {
        icon.className = 'fa-solid fa-moon';
      }
    }
  });
}

// =============================================================================
// 4. Toast Notification System
// =============================================================================

function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('smartToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'smartToastContainer';
    container.className = 'smart-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `smart-toast toast-${type}`;

  let iconClass = 'fa-circle-info';
  if (type === 'success') iconClass = 'fa-circle-check';
  if (type === 'danger') iconClass = 'fa-circle-exclamation';
  if (type === 'warning') iconClass = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass}" style="margin-top: 2px; font-size: 1.1rem;"></i>
    <div style="flex: 1; font-size: 0.9rem; font-weight: 500;">${message}</div>
    <button type="button" style="background:none; border:none; color:inherit; opacity:0.6; cursor:pointer;" onclick="this.parentElement.remove()">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOutRight 0.3s forwards';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

// =============================================================================
// 5. Sidebar & Navigation
// =============================================================================

function initNavigation() {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.querySelector('.app-sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('show');
      if (backdrop) backdrop.classList.toggle('show');
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('show');
      backdrop.classList.remove('show');
    });
  }

  // Highlight active page link
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.sidebar-link');
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'dashboard.html')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Global search input enter key handler
  const globalSearch = document.getElementById('globalSearchInput');
  if (globalSearch) {
    globalSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const query = encodeURIComponent(globalSearch.value.trim());
        if (query) {
          window.location.href = `notes.html?search=${query}`;
        }
      }
    });
  }
}

// =============================================================================
// 6. Delete Note Confirmation Helper (Connected to Backend DELETE)
// =============================================================================

let noteToDeleteId = null;

function promptDeleteNote(noteId, noteTitle) {
  noteToDeleteId = noteId;
  const modalElem = document.getElementById('deleteNoteModal');
  const titleElem = document.getElementById('deleteNoteTitle');
  if (titleElem) titleElem.textContent = noteTitle || 'this note';

  if (modalElem && window.bootstrap) {
    const modal = new bootstrap.Modal(modalElem);
    modal.show();
  } else if (confirm(`Are you sure you want to delete "${noteTitle}"?`)) {
    executeDeleteNote(noteId);
  }
}

async function confirmDeleteNote() {
  if (noteToDeleteId) {
    await executeDeleteNote(noteToDeleteId);
    noteToDeleteId = null;
    const modalElem = document.getElementById('deleteNoteModal');
    if (modalElem && window.bootstrap) {
      const modal = bootstrap.Modal.getInstance(modalElem);
      if (modal) modal.hide();
    }
  }
}

async function executeDeleteNote(noteId) {
  try {
    const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('Note deleted successfully.', 'success');
      // Refresh current page view
      if (typeof renderNotesList === 'function') {
        renderNotesList();
      } else if (typeof renderDashboard === 'function') {
        renderDashboard();
      } else if (window.location.pathname.includes('view-note.html')) {
        setTimeout(() => { window.location.href = 'notes.html'; }, 800);
      }
    } else {
      showToast(data.error || 'Failed to delete note.', 'danger');
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Failed to delete note. Check server connection.', 'danger');
  }
}

// =============================================================================
// 7. Lifecycle Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  checkAuthStatus();

  // Attach event listener to theme toggle buttons
  const themeToggles = document.querySelectorAll('.theme-toggle-btn');
  themeToggles.forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });
});

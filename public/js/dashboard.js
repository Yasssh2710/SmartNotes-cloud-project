/**
 * SmartNotes - Dashboard Logic (public/js/dashboard.js)
 * Fetches real statistics, recent study notes, and subject metrics
 * from Express backend REST endpoints (/api/notes/stats/dashboard).
 */

document.addEventListener('DOMContentLoaded', () => {
  renderDashboard();
});

async function renderDashboard() {
  try {
    const res = await fetch('/api/notes/stats/dashboard');
    if (!res.ok) {
      console.warn('Dashboard fetch failed with status:', res.status);
      return;
    }

    const data = await res.json();
    if (!data.success || !data.stats) return;

    const { totalNotes, totalSubjects, uploadedFiles, quizzesCompleted, recentNotes, subjectsMap } = data.stats;

    // 1. Dynamic Greeting
    const greetingElem = document.getElementById('dashboardGreeting');
    if (greetingElem) {
      const hour = new Date().getHours();
      let timeGreeting = "Good morning";
      if (hour >= 12 && hour < 17) timeGreeting = "Good afternoon";
      else if (hour >= 17) timeGreeting = "Good evening";

      const cachedUser = localStorage.getItem('smartnotes_user');
      let firstName = 'Student';
      if (cachedUser) {
        try { firstName = JSON.parse(cachedUser).name.split(' ')[0]; } catch (e) {}
      }
      greetingElem.innerHTML = `${timeGreeting}, ${firstName} 👋`;
    }

    // 2. Update Statistics Counters
    const statNotes = document.getElementById('statTotalNotes');
    const statSubjects = document.getElementById('statTotalSubjects');
    const statFiles = document.getElementById('statTotalFiles');
    const statQuizzes = document.getElementById('statTotalQuizzes');

    if (statNotes) statNotes.textContent = totalNotes;
    if (statSubjects) statSubjects.textContent = totalSubjects;
    if (statFiles) statFiles.textContent = uploadedFiles;
    if (statQuizzes) statQuizzes.textContent = quizzesCompleted;

    // 3. Render Recent Notes Cards
    renderRecentNotes(recentNotes || []);

    // 4. Render Subject Cards
    renderDashboardSubjects(subjectsMap || {});
  } catch (err) {
    console.error('[Dashboard] Error rendering:', err);
  }
}

function renderRecentNotes(recentNotes) {
  const container = document.getElementById('recentNotesContainer');
  if (!container) return;

  if (recentNotes.length === 0) {
    container.innerHTML = `
      <div class="col-12">
        <div class="empty-state">
          <div class="empty-state-icon"><i class="fa-regular fa-folder-open"></i></div>
          <h4 class="empty-state-title">No Notes Yet</h4>
          <p class="empty-state-text">Start building your knowledge base by creating your first study note in the database.</p>
          <a href="create-note.html" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Create Note</a>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = recentNotes.map(note => {
    const badgeClass = getSubjectBadgeClass(note.subject);
    const tagsHtml = (note.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('');

    return `
      <div class="col-lg-6 col-xl-3 mb-3">
        <div class="card-custom note-card h-100">
          <div>
            <div class="note-card-header">
              <span class="badge-subject ${badgeClass}">
                <i class="fa-solid fa-book-bookmark"></i> ${escapeHtml(note.subject)}
              </span>
              <span class="note-card-date">${formatDate(note.created_at)}</span>
            </div>
            <h3 class="note-card-title">${escapeHtml(note.title)}</h3>
            <p class="note-card-excerpt">${escapeHtml(note.content.replace(/<[^>]*>/g, '').substring(0, 110) + '...')}</p>
          </div>
          <div>
            <div class="note-card-tags">
              ${tagsHtml}
            </div>
            <div class="note-card-actions">
              <a href="view-note.html?id=${note.id}" class="note-btn-action text-primary">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
              </a>
              <div class="d-flex gap-2">
                <a href="edit-note.html?id=${note.id}" class="note-btn-action" title="Edit Note">
                  <i class="fa-solid fa-pen-to-square"></i>
                </a>
                <button type="button" class="note-btn-action action-delete" onclick="promptDeleteNote('${note.id}', '${escapeHtml(note.title)}')" title="Delete Note">
                  <i class="fa-regular fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardSubjects(subjectsMap) {
  const container = document.getElementById('dashboardSubjectsContainer');
  if (!container) return;

  const subjectsConfig = [
    { name: "Cloud Computing", icon: "fa-cloud", color: "#0284c7", bg: "#e0f2fe" },
    { name: "DBMS", icon: "fa-database", color: "#d97706", bg: "#fef3c7" },
    { name: "Computer Networks", icon: "fa-network-wired", color: "#4f46e5", bg: "#e0e7ff" },
    { name: "Artificial Intelligence", icon: "fa-brain", color: "#db2777", bg: "#fce7f3" },
    { name: "Operating Systems", icon: "fa-microchip", color: "#059669", bg: "#d1fae5" },
    { name: "Data Structures", icon: "fa-diagram-project", color: "#ea580c", bg: "#ffedd5" }
  ];

  container.innerHTML = subjectsConfig.map(sub => {
    const count = subjectsMap[sub.name] || 0;
    return `
      <div class="col-md-6 col-lg-4 mb-3">
        <div class="card-custom subject-card" onclick="window.location.href='notes.html?subject=${encodeURIComponent(sub.name)}'">
          <div class="d-flex align-items-center gap-3">
            <div class="subject-card-icon" style="background-color: ${sub.bg}; color: ${sub.color};">
              <i class="fa-solid ${sub.icon}"></i>
            </div>
            <div>
              <h4 class="subject-name">${sub.name}</h4>
              <div class="subject-count">${count} ${count === 1 ? 'study note' : 'study notes'}</div>
            </div>
          </div>
          <div class="d-flex align-items-center justify-content-between pt-2 border-top mt-3">
            <span class="text-primary font-weight-600" style="font-size: 0.85rem;">View Notes</span>
            <i class="fa-solid fa-chevron-right text-muted" style="font-size: 0.8rem;"></i>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getSubjectBadgeClass(subject) {
  switch (subject) {
    case 'Cloud Computing': return 'badge-cloud';
    case 'DBMS': return 'badge-dbms';
    case 'Computer Networks': return 'badge-cns';
    case 'Artificial Intelligence': return 'badge-ai';
    case 'Operating Systems': return 'badge-os';
    case 'Data Structures': return 'badge-dsa';
    default: return 'badge-cloud';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

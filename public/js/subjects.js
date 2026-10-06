/**
 * SmartNotes - Subjects Catalog Module (public/js/subjects.js)
 * Loads dynamic subjects from SQLite /api/subjects, displays curriculum cards,
 * and allows students to create new academic subjects.
 */

document.addEventListener('DOMContentLoaded', () => {
  initSubjectsPage();
});

async function initSubjectsPage() {
  await renderSubjectsGrid();

  const addForm = document.getElementById('addSubjectForm');
  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleCreateSubject();
    });
  }
}

async function renderSubjectsGrid() {
  const container = document.getElementById('subjectsGridContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/subjects');
    const data = await res.json();

    if (!res.ok || !data.success || !Array.isArray(data.subjects) || data.subjects.length === 0) {
      container.innerHTML = `
        <div class="col-12 text-center py-5">
          <p class="text-muted">No subjects found. Click "Add Subject" to create one.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.subjects.map(subject => {
      const icon = getSubjectMeta(subject.name);
      return `
        <div class="col-md-6 col-lg-4">
          <div class="card-custom subject-card h-100 p-4">
            <div>
              <div class="d-flex align-items-center justify-content-between mb-3">
                <div class="subject-card-icon" style="background-color: ${icon.bg}; color: ${icon.color};">
                  <i class="fa-solid ${icon.icon}"></i>
                </div>
                <span class="badge bg-primary-subtle text-primary">${escapeHtml(subject.semester || 'Curriculum')}</span>
              </div>
              <h3 class="subject-name font-weight-700 h5">${escapeHtml(subject.name)}</h3>
              <p class="text-muted" style="font-size: 0.875rem;">
                ${escapeHtml(subject.description || `Academic notes and revision guides for ${subject.name}.`)}
              </p>
              <div class="d-flex align-items-center gap-3 text-muted mb-3" style="font-size: 0.8rem;">
                <span><i class="fa-solid fa-note-sticky text-primary me-1"></i> ${subject.noteCount} ${subject.noteCount === 1 ? 'Note' : 'Notes'}</span>
                <span><i class="fa-regular fa-clock me-1"></i> Active</span>
              </div>
            </div>
            <a href="notes.html?subject=${encodeURIComponent(subject.name)}" class="btn btn-outline-primary w-100 mt-2">
              View Notes <i class="fa-solid fa-arrow-right ms-1"></i>
            </a>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Fetch subjects error:', err);
    container.innerHTML = `<div class="col-12 alert alert-danger">Error loading subjects.</div>`;
  }
}

async function handleCreateSubject() {
  const nameInput = document.getElementById('newSubjectName');
  const semInput = document.getElementById('newSubjectSemester');
  const descInput = document.getElementById('newSubjectDesc');

  if (!nameInput || !nameInput.value.trim()) {
    showToast('Please enter a subject name.', 'danger');
    return;
  }

  const name = nameInput.value.trim();
  const semester = semInput ? semInput.value : '5';
  const description = descInput ? descInput.value.trim() : '';

  try {
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, semester, description })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`Subject "${name}" created successfully.`, 'success');

      // Hide modal
      const modalElem = document.getElementById('addSubjectModal');
      if (modalElem && window.bootstrap) {
        const modal = bootstrap.Modal.getInstance(modalElem) || new bootstrap.Modal(modalElem);
        modal.hide();
      }

      // Reset form and re-render
      const form = document.getElementById('addSubjectForm');
      if (form) form.reset();

      await renderSubjectsGrid();
    } else {
      showToast(data.error || 'Failed to create subject.', 'danger');
    }
  } catch (err) {
    console.error('Create subject error:', err);
    showToast('Failed to create subject.', 'danger');
  }
}

function getSubjectMeta(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('cloud')) return { icon: 'fa-cloud', color: '#0284c7', bg: '#e0f2fe' };
  if (s.includes('dbms') || s.includes('database')) return { icon: 'fa-database', color: '#d97706', bg: '#fef3c7' };
  if (s.includes('network') || s.includes('cns')) return { icon: 'fa-network-wired', color: '#4f46e5', bg: '#e0e7ff' };
  if (s.includes('ai') || s.includes('intelligence')) return { icon: 'fa-brain', color: '#7c3aed', bg: '#ede9fe' };
  if (s.includes('operat') || s.includes('os')) return { icon: 'fa-microchip', color: '#059669', bg: '#d1fae5' };
  if (s.includes('structure') || s.includes('dsa') || s.includes('algorithm')) return { icon: 'fa-diagram-project', color: '#dc2626', bg: '#fee2e2' };
  return { icon: 'fa-book-bookmark', color: '#2563eb', bg: '#dbeafe' };
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

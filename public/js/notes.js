/**
 * SmartNotes - Notes Module (public/js/notes.js)
 * Connects Notes directory, creation, editing, and view page
 * to Express backend REST API (/api/notes), supporting both manual study notes
 * and uploaded real files (PDF, DOCX, TXT) with in-browser previews and AI links.
 */

document.addEventListener('DOMContentLoaded', () => {
  const currentPath = window.location.pathname.split('/').pop();

  if (currentPath === 'notes.html') {
    initNotesListPage();
  } else if (currentPath === 'create-note.html') {
    initCreateNotePage();
  } else if (currentPath === 'edit-note.html') {
    initEditNotePage();
  } else if (currentPath === 'view-note.html') {
    initViewNotePage();
  }
});

// =============================================================================
// 1. Notes List Page (notes.html)
// =============================================================================

let activeSubjectFilter = 'all';
let activeSearchQuery = '';
let activeSortOrder = 'newest';
let currentViewMode = 'grid';

async function initNotesListPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const subjectParam = urlParams.get('subject');
  const searchParam = urlParams.get('search');

  if (subjectParam) activeSubjectFilter = subjectParam;
  if (searchParam) {
    activeSearchQuery = searchParam;
    const searchInput = document.getElementById('notesSearchInput');
    if (searchInput) searchInput.value = searchParam;
  }

  // Bind Search Input
  let debounceTimeout = null;
  const searchInput = document.getElementById('notesSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        activeSearchQuery = e.target.value.trim();
        renderNotesList();
      }, 250);
    });
  }

  // Bind Sort Dropdown
  const sortSelect = document.getElementById('notesSortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      activeSortOrder = e.target.value;
      renderNotesList();
    });
  }

  // Bind View Mode Toggle
  const btnGrid = document.getElementById('btnViewGrid');
  const btnList = document.getElementById('btnViewList');
  if (btnGrid && btnList) {
    btnGrid.addEventListener('click', () => {
      currentViewMode = 'grid';
      btnGrid.classList.add('active');
      btnList.classList.remove('active');
      renderNotesList();
    });

    btnList.addEventListener('click', () => {
      currentViewMode = 'list';
      btnList.classList.add('active');
      btnGrid.classList.remove('active');
      renderNotesList();
    });
  }

  // Load dynamic filter pills and notes list
  await renderFilterPills();
  await renderNotesList();
}

/**
 * Loads and renders filter pills dynamically from /api/subjects
 */
async function renderFilterPills() {
  const container = document.querySelector('.notes-filter-pills');
  if (!container) return;

  try {
    const res = await fetch('/api/subjects');
    const data = await res.json();
    const subjects = (data.subjects || []).map(s => s.name);

    let pillsHtml = `
      <button type="button" class="filter-pill ${activeSubjectFilter.toLowerCase() === 'all' ? 'active' : ''}" data-subject="all">
        <i class="fa-solid fa-border-all me-1"></i> All Notes
      </button>
    `;

    subjects.forEach(subj => {
      const isActive = activeSubjectFilter.toLowerCase() === subj.toLowerCase();
      const icon = getSubjectIcon(subj);
      pillsHtml += `
        <button type="button" class="filter-pill ${isActive ? 'active' : ''}" data-subject="${escapeHtml(subj)}">
          <i class="fa-solid ${icon} me-1"></i> ${escapeHtml(subj)}
        </button>
      `;
    });

    container.innerHTML = pillsHtml;

    container.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        container.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeSubjectFilter = pill.getAttribute('data-subject');
        renderNotesList();
      });
    });
  } catch (err) {
    console.warn('Could not load subjects for filter pills:', err);
  }
}

async function renderNotesList() {
  const container = document.getElementById('notesContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="col-12 text-center py-5">
      <i class="fa-solid fa-circle-notch fa-spin text-primary fs-3"></i>
      <div class="text-muted mt-2">Loading notes from database...</div>
    </div>
  `;

  try {
    const queryParams = new URLSearchParams();
    if (activeSubjectFilter && activeSubjectFilter !== 'all') {
      queryParams.append('subject', activeSubjectFilter);
    }
    if (activeSearchQuery) {
      queryParams.append('search', activeSearchQuery);
    }
    if (activeSortOrder) {
      queryParams.append('sort', activeSortOrder);
    }

    const res = await fetch(`/api/notes?${queryParams.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      container.innerHTML = `<div class="col-12 alert alert-danger">Failed to load notes.</div>`;
      return;
    }

    const notes = data.notes || [];

    // Update count badge
    const countBadge = document.getElementById('notesCountDisplay');
    if (countBadge) {
      countBadge.textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
    }

    // Handle empty state
    if (notes.length === 0) {
      container.innerHTML = `
        <div class="col-12">
          <div class="empty-state">
            <div class="empty-state-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
            <h3 class="empty-state-title">No notes found</h3>
            <p class="empty-state-text">
              ${activeSearchQuery ? `No matching notes found for "${escapeHtml(activeSearchQuery)}". Try adjusting your search or filter.` : 'No study notes or uploaded files in this category yet.'}
            </p>
            <div class="d-flex justify-content-center gap-2">
              <button class="btn btn-outline-primary" onclick="resetNotesFilter()"><i class="fa-solid fa-rotate-left"></i> Reset Filters</button>
              <a href="upload.html" class="btn btn-outline-primary"><i class="fa-solid fa-cloud-arrow-up"></i> Upload Material</a>
              <a href="create-note.html" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Create Note</a>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Render Grid or List View
    if (currentViewMode === 'grid') {
      container.innerHTML = `
        <div class="notes-grid w-100">
          ${notes.map(note => {
            const badgeClass = getSubjectBadgeClass(note.subject);
            const isFile = !!(note.isFile || note.file_id || note.original_filename);
            let fileBadge = '';

            if (isFile) {
              const ext = (note.fileExt || (note.title.includes('.') ? note.title.split('.').pop() : 'FILE')).toUpperCase();
              if (ext === 'PDF') {
                fileBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="fa-solid fa-file-pdf me-1"></i> PDF</span>`;
              } else if (ext === 'DOCX' || ext === 'DOC') {
                fileBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1"><i class="fa-solid fa-file-word me-1"></i> Word</span>`;
              } else if (ext === 'TXT') {
                fileBadge = `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1"><i class="fa-solid fa-file-lines me-1"></i> Text</span>`;
              } else {
                fileBadge = `<span class="badge bg-info-subtle text-info border border-info-subtle px-2 py-1"><i class="fa-solid fa-paperclip me-1"></i> File</span>`;
              }
            }

            const tagsHtml = (note.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('');
            const cleanSnippet = note.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            return `
              <div class="card-custom note-card">
                <div>
                  <div class="note-card-header d-flex align-items-center justify-content-between mb-2">
                    <div class="d-flex align-items-center gap-1 flex-wrap">
                      <span class="badge-subject ${badgeClass}">
                        <i class="fa-solid fa-book-bookmark"></i> ${escapeHtml(note.subject)}
                      </span>
                      ${fileBadge}
                    </div>
                    <span class="note-card-date">${formatDate(note.created_at)}</span>
                  </div>
                  <h3 class="note-card-title mb-2">${escapeHtml(note.title)}</h3>
                  <p class="note-card-excerpt">${escapeHtml(cleanSnippet.substring(0, 120) + (cleanSnippet.length > 120 ? '...' : ''))}</p>
                </div>
                <div>
                  <div class="note-card-tags mb-3">
                    ${tagsHtml}
                  </div>
                  <div class="note-card-actions d-flex align-items-center justify-content-between">
                    <a href="view-note.html?id=${note.id}" class="note-btn-action text-primary font-weight-600">
                      <i class="fa-solid fa-arrow-up-right-from-square"></i> Open
                    </a>
                    <div class="d-flex gap-2 align-items-center">
                      <a href="summary.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-info" title="Generate AI Summary">
                        <i class="fa-solid fa-bolt"></i> Summary
                      </a>
                      <a href="quiz.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-warning" title="Take AI Quiz">
                        <i class="fa-solid fa-circle-question"></i> Quiz
                      </a>
                      <a href="ask.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-success" title="Ask My Notes">
                        <i class="fa-solid fa-comments"></i> Ask AI
                      </a>
                      <button type="button" class="note-btn-action action-delete" onclick="promptDeleteNote('${note.id}', '${escapeHtml(note.title)}')" title="Delete Note">
                        <i class="fa-regular fa-trash-can"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="notes-list-view w-100">
          ${notes.map(note => {
            const badgeClass = getSubjectBadgeClass(note.subject);
            const isFile = !!(note.isFile || note.file_id || note.original_filename);
            let fileBadge = '';

            if (isFile) {
              const ext = (note.fileExt || (note.title.includes('.') ? note.title.split('.').pop() : 'FILE')).toUpperCase();
              if (ext === 'PDF') {
                fileBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle ms-1"><i class="fa-solid fa-file-pdf"></i> PDF</span>`;
              } else if (ext === 'DOCX' || ext === 'DOC') {
                fileBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1"><i class="fa-solid fa-file-word"></i> Word</span>`;
              } else if (ext === 'TXT') {
                fileBadge = `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle ms-1"><i class="fa-solid fa-file-lines"></i> Text</span>`;
              }
            }

            return `
              <div class="note-list-item">
                <div class="note-list-main">
                  <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                    <span class="badge-subject ${badgeClass}">${escapeHtml(note.subject)}</span>
                    ${fileBadge}
                    <span class="text-muted" style="font-size: 0.8rem;">• ${formatDate(note.created_at)}</span>
                  </div>
                  <h4 class="note-list-title mb-1">${escapeHtml(note.title)}</h4>
                  <div class="note-list-meta">
                    <span><i class="fa-regular fa-folder"></i> ${escapeHtml(note.topic || 'General Revision')}</span>
                    <span><i class="fa-solid fa-tags"></i> ${(note.tags || []).join(', ')}</span>
                  </div>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <a href="view-note.html?id=${note.id}" class="btn btn-sm btn-outline-primary">
                    <i class="fa-solid fa-eye"></i> View
                  </a>
                  <a href="summary.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-info" title="AI Summary">
                    <i class="fa-solid fa-bolt"></i> Summary
                  </a>
                  <a href="quiz.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-warning" title="AI Quiz">
                    <i class="fa-solid fa-circle-question"></i> Quiz
                  </a>
                  <a href="ask.html?noteId=${note.id}" class="btn btn-sm btn-light-custom text-success" title="Ask My Notes">
                    <i class="fa-solid fa-comments"></i> Ask AI
                  </a>
                  <button type="button" class="btn btn-sm btn-light-custom text-danger" onclick="promptDeleteNote('${note.id}', '${escapeHtml(note.title)}')">
                    <i class="fa-regular fa-trash-can"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } catch (err) {
    console.error('[Notes] Render error:', err);
    container.innerHTML = `<div class="col-12 alert alert-danger">Error connecting to server.</div>`;
  }
}

function resetNotesFilter() {
  activeSubjectFilter = 'all';
  activeSearchQuery = '';
  const searchInput = document.getElementById('notesSearchInput');
  if (searchInput) searchInput.value = '';

  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(p => {
    if (p.getAttribute('data-subject') === 'all') p.classList.add('active');
    else p.classList.remove('active');
  });

  renderNotesList();
}

// =============================================================================
// 2. Create Note Page (create-note.html)
// =============================================================================

async function initCreateNotePage() {
  await populateSubjectSelect('noteSubject');

  const form = document.getElementById('createNoteForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveNewNote(false);
  });

  const draftBtn = document.getElementById('btnSaveDraft');
  if (draftBtn) {
    draftBtn.addEventListener('click', async () => {
      await saveNewNote(true);
    });
  }
}

async function saveNewNote(isDraft = false) {
  const titleInput = document.getElementById('noteTitle');
  const subjectInput = document.getElementById('noteSubject');
  const topicInput = document.getElementById('noteTopic');
  const tagsInput = document.getElementById('noteTags');
  const contentInput = document.getElementById('noteContent');

  if (!titleInput.value.trim()) {
    showToast('Please provide a title for the note.', 'danger');
    titleInput.focus();
    return;
  }

  if (!subjectInput.value) {
    showToast('Please select an academic subject.', 'danger');
    subjectInput.focus();
    return;
  }

  if (!contentInput.value.trim()) {
    showToast('Please enter note content.', 'danger');
    contentInput.focus();
    return;
  }

  const submitBtn = document.getElementById('btnSaveNote');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Saving...';
  }

  try {
    const formattedContent = contentInput.value.includes('<p>')
      ? contentInput.value
      : `<p>${contentInput.value.trim().replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;

    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: titleInput.value.trim(),
        subject: subjectInput.value,
        topic: topicInput.value.trim(),
        tags: tagsInput.value.trim(),
        content: formattedContent
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to save note.', 'danger');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Note';
      }
      return;
    }

    showToast(isDraft ? 'Note saved as draft.' : 'Note created successfully in database.', 'success');
    setTimeout(() => {
      window.location.href = `view-note.html?id=${data.note.id}`;
    }, 700);
  } catch (err) {
    console.error('Note create error:', err);
    showToast('Error saving note. Please verify server connection.', 'danger');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Note';
    }
  }
}

// =============================================================================
// 3. Edit Note Page (edit-note.html)
// =============================================================================

async function initEditNotePage() {
  const urlParams = new URLSearchParams(window.location.search);
  const noteId = urlParams.get('id');

  if (!noteId) {
    showToast('No note specified to edit.', 'warning');
    setTimeout(() => { window.location.href = 'notes.html'; }, 800);
    return;
  }

  await populateSubjectSelect('editNoteSubject');

  try {
    const res = await fetch(`/api/notes/${noteId}`);
    const data = await res.json();

    if (!res.ok || !data.success || !data.note) {
      showToast('Study note not found.', 'danger');
      setTimeout(() => { window.location.href = 'notes.html'; }, 800);
      return;
    }

    const note = data.note;
    const titleInput = document.getElementById('editNoteTitle');
    const subjectInput = document.getElementById('editNoteSubject');
    const topicInput = document.getElementById('editNoteTopic');
    const tagsInput = document.getElementById('editNoteTags');
    const contentInput = document.getElementById('editNoteContent');
    const noteIdInput = document.getElementById('editNoteId');

    if (titleInput) titleInput.value = note.title;
    if (subjectInput) subjectInput.value = note.subject;
    if (topicInput) topicInput.value = note.topic || '';
    if (tagsInput) tagsInput.value = (note.tags || []).join(', ');
    if (noteIdInput) noteIdInput.value = note.id;

    if (contentInput) {
      contentInput.value = note.content.replace(/<[^>]*>/g, '\n').replace(/\n\n+/g, '\n\n').trim();
    }

    const form = document.getElementById('editNoteForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateExistingNote(note.id);
      });
    }
  } catch (err) {
    console.error('Edit note fetch error:', err);
  }
}

async function updateExistingNote(noteId) {
  const titleInput = document.getElementById('editNoteTitle');
  const subjectInput = document.getElementById('editNoteSubject');
  const topicInput = document.getElementById('editNoteTopic');
  const tagsInput = document.getElementById('editNoteTags');
  const contentInput = document.getElementById('editNoteContent');

  if (!titleInput.value.trim()) {
    showToast('Please enter a note title.', 'danger');
    return;
  }

  const submitBtn = document.getElementById('btnUpdateNote');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Updating...';
  }

  try {
    const formattedContent = contentInput.value.includes('<p>')
      ? contentInput.value
      : `<p>${contentInput.value.trim().replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;

    const res = await fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: titleInput.value.trim(),
        subject: subjectInput.value,
        topic: topicInput.value.trim(),
        tags: tagsInput.value.trim(),
        content: formattedContent
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to update note.', 'danger');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Update Note';
      }
      return;
    }

    showToast('Note updated successfully in database.', 'success');
    setTimeout(() => {
      window.location.href = `view-note.html?id=${noteId}`;
    }, 700);
  } catch (err) {
    console.error('Update note error:', err);
    showToast('Failed to update note.', 'danger');
  }
}

// =============================================================================
// 4. View Note Page (view-note.html)
// =============================================================================

async function initViewNotePage() {
  const urlParams = new URLSearchParams(window.location.search);
  let noteId = urlParams.get('id');

  if (!noteId) {
    try {
      const listRes = await fetch('/api/notes');
      const listData = await listRes.json();
      if (listData.notes && listData.notes.length > 0) {
        noteId = listData.notes[0].id;
      }
    } catch (e) {}
  }

  if (!noteId) {
    showToast('No notes available. Redirecting...', 'warning');
    setTimeout(() => { window.location.href = 'notes.html'; }, 800);
    return;
  }

  try {
    const res = await fetch(`/api/notes/${noteId}`);
    const data = await res.json();

    if (!res.ok || !data.success || !data.note) {
      showToast('Note not found.', 'danger');
      setTimeout(() => { window.location.href = 'notes.html'; }, 800);
      return;
    }

    const note = data.note;
    const isFile = !!(note.isFile || note.file_id || note.attachedFile);

    const titleElem = document.getElementById('viewNoteTitle');
    const subjectBadge = document.getElementById('viewNoteSubjectBadge');
    const dateElem = document.getElementById('viewNoteDate');
    const topicElem = document.getElementById('viewNoteTopic');
    const tagsContainer = document.getElementById('viewNoteTagsContainer');
    const bodyElem = document.getElementById('viewNoteContentBody');
    const editBtn = document.getElementById('viewNoteEditBtn');
    const deleteBtn = document.getElementById('viewNoteDeleteBtn');
    const aiSummaryBtn = document.getElementById('viewNoteAiSummaryBtn');
    const aiQuizBtn = document.getElementById('viewNoteAiQuizBtn');

    if (titleElem) titleElem.textContent = note.title;
    if (dateElem) dateElem.textContent = formatDate(note.created_at);
    if (topicElem) topicElem.textContent = note.topic || (isFile ? 'Uploaded Document' : 'General Revision');

    if (subjectBadge) {
      subjectBadge.className = `badge-subject ${getSubjectBadgeClass(note.subject)}`;
      subjectBadge.innerHTML = `<i class="fa-solid fa-book-bookmark"></i> ${escapeHtml(note.subject)}`;
    }

    if (tagsContainer) {
      tagsContainer.innerHTML = (note.tags || []).map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('');
    }

    if (editBtn) {
      if (isFile) {
        editBtn.style.display = 'none'; // Editing raw binary file text directly not recommended
      } else {
        editBtn.href = `edit-note.html?id=${note.id}`;
      }
    }

    if (deleteBtn) {
      deleteBtn.onclick = () => promptDeleteNote(note.id, note.title);
    }

    if (aiSummaryBtn) aiSummaryBtn.href = `summary.html?noteId=${note.id}`;
    if (aiQuizBtn) aiQuizBtn.href = `quiz.html?noteId=${note.id}`;

    // Render Body with Document Info & PDF Preview if file
    if (bodyElem) {
      let fileBannerHtml = '';
      let pdfPreviewHtml = '';
      const fileId = note.file_id || (note.attachedFile ? note.attachedFile.id : null);

      if (isFile && fileId) {
        const fileExt = (note.fileExt || (note.title.includes('.') ? note.title.split('.').pop() : 'FILE')).toUpperCase();
        const sizeFormatted = note.fileSizeFormatted || (note.attachedFile && note.attachedFile.file_size ? `${Math.round(note.attachedFile.file_size / 1024)} KB` : 'Uploaded');

        let fileIcon = 'fa-file-lines text-secondary';
        if (fileExt === 'PDF') fileIcon = 'fa-file-pdf text-danger';
        else if (fileExt === 'DOCX' || fileExt === 'DOC') fileIcon = 'fa-file-word text-primary';

        fileBannerHtml = `
          <div class="card-custom p-3 mb-4 d-flex align-items-center justify-content-between flex-wrap gap-3" style="background: var(--bg-card); border-left: 4px solid var(--primary);">
            <div class="d-flex align-items-center gap-3">
              <i class="fa-solid ${fileIcon} fs-2"></i>
              <div>
                <div class="font-weight-700" style="font-size: 1.05rem;">${escapeHtml(note.title)}</div>
                <div class="text-muted" style="font-size: 0.85rem;">
                  <span>Format: <strong>${fileExt}</strong></span> &bull; 
                  <span>Size: <strong>${sizeFormatted}</strong></span> &bull; 
                  <span>Subject: <strong>${escapeHtml(note.subject)}</strong></span>
                </div>
              </div>
            </div>
            <div class="d-flex gap-2">
              <a href="/api/files/${fileId}/download" class="btn btn-sm btn-outline-primary">
                <i class="fa-solid fa-download"></i> Download File
              </a>
              <a href="summary.html?noteId=${note.id}" class="btn btn-sm btn-primary">
                <i class="fa-solid fa-bolt"></i> AI Summary
              </a>
              <a href="quiz.html?noteId=${note.id}" class="btn btn-sm btn-outline-primary">
                <i class="fa-solid fa-circle-question"></i> AI Quiz
              </a>
              <a href="ask.html?noteId=${note.id}" class="btn btn-sm btn-outline-success">
                <i class="fa-solid fa-comments"></i> Ask Notes
              </a>
            </div>
          </div>
        `;

        if (fileExt === 'PDF') {
          pdfPreviewHtml = `
            <div class="mb-4">
              <div class="d-flex align-items-center justify-content-between mb-2">
                <h5 class="font-weight-700 mb-0" style="font-size: 1rem;">
                  <i class="fa-solid fa-file-pdf text-danger me-2"></i> PDF Document Viewer
                </h5>
                <a href="/api/files/${fileId}/preview" target="_blank" class="text-primary font-weight-600" style="font-size: 0.85rem;">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i> Open in New Tab
                </a>
              </div>
              <div class="pdf-viewer-box" style="height: 580px; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-color);">
                <iframe src="/api/files/${fileId}/preview" width="100%" height="100%" style="border: none;"></iframe>
              </div>
            </div>
          `;
        }
      }

      const cleanContentCheck = (note.content || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hasRealText = cleanContentCheck.split(/\s+/).filter(w => w.length > 1).length >= 5;

      let contentDisplayHtml = '';
      if (hasRealText) {
        contentDisplayHtml = `
          <div class="p-3 rounded" style="background: var(--bg-main); border: 1px solid var(--border-color); line-height: 1.8;">
            ${note.content}
          </div>
        `;
      } else if (isFile) {
        contentDisplayHtml = `
          <div class="alert alert-warning d-flex align-items-start gap-3 p-3" style="border-radius: var(--radius-md);">
            <i class="fa-solid fa-triangle-exclamation fs-3 text-warning mt-1"></i>
            <div>
              <strong class="d-block mb-1">Scanned Document / OCR Notice:</strong>
              <div class="text-muted" style="font-size: 0.875rem; line-height: 1.6;">
                This uploaded PDF contains scanned page images without an embedded selectable text layer. You can view all pages clearly using the <strong>PDF Document Viewer</strong> above. To generate AI Summaries and Quizzes with Google Gemini, please upload a text-based PDF, DOCX, or TXT study note.
              </div>
            </div>
          </div>
        `;
      } else {
        contentDisplayHtml = `
          <div class="p-3 rounded" style="background: var(--bg-main); border: 1px solid var(--border-color); line-height: 1.8;">
            ${note.content}
          </div>
        `;
      }

      bodyElem.innerHTML = `
        ${fileBannerHtml}
        ${pdfPreviewHtml}
        <div class="note-main-text">
          <div class="d-flex align-items-center gap-2 mb-3">
            <h5 class="font-weight-700 mb-0" style="font-size: 1rem;">
              <i class="fa-solid fa-align-left text-primary me-2"></i> ${hasRealText ? 'Note Content' : 'Document Status'}
            </h5>
          </div>
          ${contentDisplayHtml}
        </div>
      `;
    }
  } catch (err) {
    console.error('View note fetch error:', err);
  }
}

async function populateSubjectSelect(elementId) {
  const select = document.getElementById(elementId);
  if (!select) return;

  try {
    const res = await fetch('/api/subjects');
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.subjects) && data.subjects.length > 0) {
      const currentVal = select.value;
      select.innerHTML = data.subjects.map(s => `
        <option value="${escapeHtml(s.name)}" ${currentVal && currentVal.toLowerCase() === s.name.toLowerCase() ? 'selected' : ''}>
          ${escapeHtml(s.name)}
        </option>
      `).join('');
    }
  } catch (err) {
    console.warn('Could not load subjects for select:', err);
  }
}

function getSubjectIcon(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('cloud')) return 'fa-cloud';
  if (s.includes('dbms') || s.includes('database')) return 'fa-database';
  if (s.includes('network') || s.includes('cns')) return 'fa-network-wired';
  if (s.includes('ai') || s.includes('intelligence')) return 'fa-brain';
  if (s.includes('operat') || s.includes('os')) return 'fa-microchip';
  if (s.includes('structure') || s.includes('dsa') || s.includes('algorithm')) return 'fa-diagram-project';
  return 'fa-book-bookmark';
}

function getSubjectBadgeClass(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('cloud')) return 'badge-cloud';
  if (s.includes('dbms') || s.includes('database')) return 'badge-dbms';
  if (s.includes('network') || s.includes('cns')) return 'badge-cns';
  if (s.includes('ai') || s.includes('intelligence')) return 'badge-ai';
  if (s.includes('operat') || s.includes('os')) return 'badge-os';
  if (s.includes('structure') || s.includes('dsa')) return 'badge-dsa';
  return 'badge-cloud';
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

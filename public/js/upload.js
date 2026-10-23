/**
 * SmartNotes - Document Upload Module (public/js/upload.js)
 * Connects file uploads to backend Express /api/files/upload with multer,
 * AWS S3 streaming, automatic note registration, and dynamic subject assignment.
 */

document.addEventListener('DOMContentLoaded', () => {
  initUploadPage();
});

function initUploadPage() {
  const dropZone = document.getElementById('uploadDropZone');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('btnBrowseFiles');
  const toggleSubjectBtn = document.getElementById('btnToggleNewSubject');
  const addCustomSubjectBtn = document.getElementById('btnAddCustomSubjectBtn');
  const cancelCustomSubjectBtn = document.getElementById('btnCancelCustomSubjectBtn');
  const newSubjectGroup = document.getElementById('newSubjectInputGroup');
  const customSubjectInput = document.getElementById('customSubjectInput');

  loadSubjectOptions();
  renderRecentUploadsTable();

  // Subject creation toggles
  if (toggleSubjectBtn && newSubjectGroup) {
    toggleSubjectBtn.addEventListener('click', () => {
      const isVisible = newSubjectGroup.style.display !== 'none';
      newSubjectGroup.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && customSubjectInput) {
        customSubjectInput.focus();
      }
    });
  }

  if (cancelCustomSubjectBtn && newSubjectGroup) {
    cancelCustomSubjectBtn.addEventListener('click', () => {
      newSubjectGroup.style.display = 'none';
      if (customSubjectInput) customSubjectInput.value = '';
    });
  }

  if (addCustomSubjectBtn && customSubjectInput) {
    addCustomSubjectBtn.addEventListener('click', async () => {
      const name = customSubjectInput.value.trim();
      if (!name) {
        showToast('Please enter a subject name.', 'warning');
        return;
      }
      await createNewSubjectFromUpload(name);
    });
  }

  // Browse button click
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
  }

  // Dropzone click
  if (dropZone) {
    dropZone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON' && fileInput) {
        fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-active');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-active');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0) {
        processSelectedFile(files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        processSelectedFile(e.target.files[0]);
      }
    });
  }
}

/**
 * Loads dynamic subjects from backend
 */
async function loadSubjectOptions(selectedName = null) {
  const selectElem = document.getElementById('uploadSubjectSelect');
  if (!selectElem) return;

  try {
    const res = await fetch('/api/subjects');
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.subjects) && data.subjects.length > 0) {
      const currentVal = selectedName || selectElem.value;
      selectElem.innerHTML = data.subjects.map(s => `
        <option value="${escapeHtml(s.name)}" ${currentVal && currentVal.toLowerCase() === s.name.toLowerCase() ? 'selected' : ''}>
          ${escapeHtml(s.name)}
        </option>
      `).join('');
    }
  } catch (err) {
    console.warn('Could not load subjects for upload dropdown:', err);
  }
}

/**
 * Handles adding a custom subject from upload page
 */
async function createNewSubjectFromUpload(subjectName) {
  try {
    const res = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: subjectName, semester: 'Elective' })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`Subject "${subjectName}" added successfully.`, 'success');
      await loadSubjectOptions(subjectName);
      const newSubjectGroup = document.getElementById('newSubjectInputGroup');
      const customSubjectInput = document.getElementById('customSubjectInput');
      if (newSubjectGroup) newSubjectGroup.style.display = 'none';
      if (customSubjectInput) customSubjectInput.value = '';
    } else {
      showToast(data.error || 'Failed to create subject.', 'danger');
    }
  } catch (err) {
    console.error('Create subject error:', err);
    showToast('Failed to create subject.', 'danger');
  }
}

/**
 * Validates selected file and uploads to backend
 */
async function processSelectedFile(file) {
  const allowedExtensions = ['pdf', 'docx', 'doc', 'txt'];
  const ext = file.name.split('.').pop().toLowerCase();
  const maxSizeBytes = 25 * 1024 * 1024; // 25MB limit

  if (!allowedExtensions.includes(ext)) {
    showToast('Invalid format. Please upload PDF, DOCX, or TXT.', 'danger');
    return;
  }

  if (file.size > maxSizeBytes) {
    showToast('File size exceeds the 25 MB limit.', 'warning');
    return;
  }

  const customInput = document.getElementById('customSubjectInput');
  const subjectSelect = document.getElementById('uploadSubjectSelect');
  let subjectName = 'Cloud Computing';

  if (customInput && customInput.value.trim() && customInput.parentElement.parentElement.style.display !== 'none') {
    subjectName = customInput.value.trim();
  } else if (subjectSelect && subjectSelect.value) {
    subjectName = subjectSelect.value;
  }

  await uploadFileToBackend(file, subjectName);
}

/**
 * Sends file to Express backend /api/files/upload
 */
async function uploadFileToBackend(file, subjectName) {
  const progressContainer = document.getElementById('uploadProgressContainer');
  const progressBar = document.getElementById('uploadProgressBar');
  const progressText = document.getElementById('uploadProgressText');
  const fileNameDisplay = document.getElementById('uploadFileNameDisplay');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('btnBrowseFiles');

  const isPdf = file.name.toLowerCase().endsWith('.pdf');

  // Disable file inputs during upload to prevent duplicate submissions
  if (fileInput) fileInput.disabled = true;
  if (browseBtn) browseBtn.disabled = true;

  if (progressContainer) progressContainer.style.display = 'block';
  if (fileNameDisplay) fileNameDisplay.textContent = file.name;
  if (progressBar) progressBar.style.width = '20%';
  if (progressText) progressText.textContent = isPdf ? 'Analyzing PDF pages & text layer...' : 'Reading document content...';

  const controller = new AbortController();
  const abortTimeout = setTimeout(() => {
    controller.abort();
  }, 45000); // 45-second HTTP upload safeguard

  const formData = new FormData();
  formData.append('file', file);
  formData.append('subject', subjectName);

  try {
    const res = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(abortTimeout);

    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(`Server returned status ${res.status} (${res.statusText || 'Unexpected response'}).`);
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Upload failed.');
    }

    // Check if the file is processing asynchronously (e.g. scanned PDF running OCR)
    if (data.status === 'processing') {
      if (progressBar) progressBar.style.width = '35%';
      if (progressText) progressText.textContent = data.message || 'Extracting scanned pages with OCR...';
      renderRecentUploadsTable(); // Show in table immediately with "Processing" status
      pollFileStatus(data.fileId || (data.file && data.file.id), file.name);
      return;
    }

    // Text-based file or instant extraction completed
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Complete!';

    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
      showToast(`"${file.name}" uploaded and added to My Notes!`, 'success');
      renderRecentUploadsTable();
      if (fileInput) {
        fileInput.disabled = false;
        fileInput.value = '';
      }
      if (browseBtn) browseBtn.disabled = false;
    }, 400);

  } catch (err) {
    clearTimeout(abortTimeout);
    console.error('File upload error:', err);
    if (progressContainer) progressContainer.style.display = 'none';

    if (err.name === 'AbortError') {
      showToast('Upload connection timed out. Please try again.', 'danger');
    } else {
      showToast(err.message || 'Failed to upload file. Check server connection.', 'danger');
    }

    if (fileInput) {
      fileInput.disabled = false;
      fileInput.value = '';
    }
    if (browseBtn) browseBtn.disabled = false;
  }
}

/**
 * Polls status of asynchronously processed files (e.g. scanned PDFs)
 */
async function pollFileStatus(fileId, fileName) {
  const progressContainer = document.getElementById('uploadProgressContainer');
  const progressBar = document.getElementById('uploadProgressBar');
  const progressText = document.getElementById('uploadProgressText');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('btnBrowseFiles');

  let attempts = 0;
  const maxAttempts = 60; // 60 * 2s = 120 seconds maximum polling safeguard
  let pollPercent = 35;

  const timer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/files/${fileId}/status`);
      const data = await res.json();

      if (res.ok && data.success) {
        if (data.message && progressText) {
          progressText.textContent = data.message;
        }

        if (data.status === 'processing') {
          if (pollPercent < 85) {
            pollPercent += 3;
            if (progressBar) progressBar.style.width = `${pollPercent}%`;
          }
        } else if (data.status === 'ready') {
          clearInterval(timer);
          if (progressBar) progressBar.style.width = '100%';
          if (progressText) progressText.textContent = 'OCR processing complete!';
          setTimeout(() => {
            if (progressContainer) progressContainer.style.display = 'none';
            showToast(`"${fileName}" scanned pages recognized with OCR & added to My Notes!`, 'success');
            renderRecentUploadsTable();
            if (fileInput) {
              fileInput.disabled = false;
              fileInput.value = '';
            }
            if (browseBtn) browseBtn.disabled = false;
          }, 600);
          return;
        } else if (data.status === 'failed') {
          clearInterval(timer);
          if (progressContainer) progressContainer.style.display = 'none';
          showToast(data.message || 'OCR processing failed on this document.', 'danger');
          renderRecentUploadsTable();
          if (fileInput) {
            fileInput.disabled = false;
            fileInput.value = '';
          }
          if (browseBtn) browseBtn.disabled = false;
          return;
        }
      }
    } catch (pollErr) {
      console.warn('Status poll warning:', pollErr);
    }

    if (attempts >= maxAttempts) {
      clearInterval(timer);
      if (progressContainer) progressContainer.style.display = 'none';
      showToast('OCR processing is taking longer than usual. Please check Recent Uploads in a moment.', 'warning');
      renderRecentUploadsTable();
      if (fileInput) {
        fileInput.disabled = false;
        fileInput.value = '';
      }
      if (browseBtn) browseBtn.disabled = false;
    }
  }, 2000);
}

/**
 * Fetches and renders recent uploaded files from SQLite database
 */
async function renderRecentUploadsTable() {
  const tbody = document.getElementById('recentUploadsTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/files');
    const data = await res.json();

    const storageBadge = document.getElementById('storageModeBadge');
    if (storageBadge && data) {
      if (data.isS3Configured) {
        storageBadge.className = 'badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1';
        storageBadge.innerHTML = '<i class="fa-brands fa-aws me-1"></i> Amazon S3';
      } else {
        storageBadge.className = 'badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1';
        storageBadge.innerHTML = '<i class="fa-solid fa-database me-1"></i> Database Storage';
      }
    }

    if (!res.ok || !data.success || !data.files || data.files.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-4 text-muted">
            No files uploaded yet. Drag and drop your study notes above.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.files.map(item => {
      let fileIcon = 'fa-file-pdf text-danger';
      if (item.name.endsWith('.docx') || item.name.endsWith('.doc')) fileIcon = 'fa-file-word text-primary';
      if (item.name.endsWith('.txt')) fileIcon = 'fa-file-lines text-secondary';

      const isS3 = item.isS3;
      let statusBadge;
      if (item.statusState === 'processing') {
        statusBadge = `<span class="badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1" style="font-size: 0.75rem;"><i class="fa-solid fa-spinner fa-spin me-1"></i> Processing (OCR)</span>`;
      } else if (item.statusState === 'failed') {
        statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1" style="font-size: 0.75rem;" title="${escapeHtml(item.statusMessage || 'Processing failed')}"><i class="fa-solid fa-circle-exclamation me-1"></i> OCR Failed</span>`;
      } else if (isS3) {
        statusBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1" style="font-size: 0.75rem;"><i class="fa-brands fa-aws me-1"></i> Amazon S3</span>`;
      } else {
        statusBadge = `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2 py-1" style="font-size: 0.75rem;"><i class="fa-solid fa-database me-1"></i> Database Storage</span>`;
      }

      return `
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <i class="fa-solid ${fileIcon}" style="font-size: 1.25rem;"></i>
              <span class="font-weight-600">${escapeHtml(item.name)}</span>
            </div>
          </td>
          <td>
            <span class="badge-subject badge-cloud">${escapeHtml(item.subject)}</span>
          </td>
          <td class="text-muted">${item.date}</td>
          <td>
            ${statusBadge}
          </td>
          <td>
            <div class="d-flex gap-2">
              ${item.noteId ? `
                <a href="view-note.html?id=${item.noteId}" class="btn btn-sm btn-outline-primary" title="Open in My Notes">
                  <i class="fa-solid fa-eye"></i> View
                </a>
                <a href="summary.html?noteId=${item.noteId}" class="btn btn-sm btn-light-custom text-info" title="AI Summary">
                  <i class="fa-solid fa-bolt"></i>
                </a>
                <a href="quiz.html?noteId=${item.noteId}" class="btn btn-sm btn-light-custom text-warning" title="AI Quiz">
                  <i class="fa-solid fa-circle-question"></i>
                </a>
                <a href="ask.html?fileId=${item.id}&noteId=${item.noteId}" class="btn btn-sm btn-light-custom text-success" title="Ask My Notes AI">
                  <i class="fa-solid fa-comments"></i>
                </a>
              ` : (item.statusState === 'failed' ? `
                <button type="button" class="btn btn-sm btn-outline-warning" title="Retry Failed OCR" onclick="retryFailedUpload('${item.id}')">
                  <i class="fa-solid fa-arrows-rotate"></i> Retry
                </button>
              ` : '')}
              <a href="/api/files/${item.id}/download" class="btn btn-sm btn-light-custom" title="Download File">
                <i class="fa-solid fa-download"></i>
              </a>
              <button type="button" class="btn btn-sm btn-light-custom text-danger" title="Delete File" onclick="deleteUploadedFile('${item.id}')">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Fetch uploads error:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">Error loading files from server.</td></tr>`;
  }
}

async function deleteUploadedFile(fileId) {
  if (!confirm('Are you sure you want to delete this uploaded file?')) return;

  try {
    const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast('File and note removed successfully.', 'info');
      renderRecentUploadsTable();
    } else {
      showToast(data.error || 'Failed to delete file.', 'danger');
    }
  } catch (err) {
    console.error('Delete file error:', err);
    showToast('Failed to delete file.', 'danger');
  }
}

async function retryFailedUpload(fileId) {
  try {
    const res = await fetch(`/api/files/${fileId}/retry-ocr`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Retry initiated for failed pages.', 'info');
      renderRecentUploadsTable();
      pollFileStatus(fileId, 'Document');
    } else {
      showToast(data.error || 'Failed to retry OCR.', 'danger');
    }
  } catch (err) {
    console.error('Retry OCR error:', err);
    showToast('Failed to retry OCR.', 'danger');
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

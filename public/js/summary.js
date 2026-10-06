/**
 * SmartNotes - AI Summary Module (public/js/summary.js)
 * Connects frontend summary interface to backend /api/ai/summary with Google Gemini API.
 * Gracefully handles unconfigured Gemini API key without crashing.
 */

let currentSummaryData = null;
let notesList = [];

document.addEventListener('DOMContentLoaded', () => {
  initSummaryPage();
});

async function initSummaryPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetNoteId = urlParams.get('noteId');

  // Load notes from backend
  try {
    const res = await fetch('/api/notes');
    const data = await res.json();
    notesList = data.notes || [];

    const noteSelect = document.getElementById('summaryNoteSelect');
    if (noteSelect && notesList.length > 0) {
      noteSelect.innerHTML = notesList.map(n => `
        <option value="${n.id}" ${targetNoteId && String(n.id) === String(targetNoteId) ? 'selected' : ''}>
          ${escapeHtml(n.title)} (${escapeHtml(n.subject)})
        </option>
      `).join('');

      noteSelect.addEventListener('change', (e) => {
        const chosen = notesList.find(n => String(n.id) === String(e.target.value));
        if (chosen) generateSummary(chosen);
      });
    }

    const selectedNote = notesList.find(n => String(n.id) === String(targetNoteId)) || notesList[0];
    if (selectedNote) {
      generateSummary(selectedNote);
    }
  } catch (err) {
    console.error('Failed to load notes for summary:', err);
  }

  // Bind Action Buttons
  const regenBtn = document.getElementById('btnRegenerateSummary');
  if (regenBtn) {
    regenBtn.addEventListener('click', () => {
      const noteSelect = document.getElementById('summaryNoteSelect');
      const noteId = noteSelect ? noteSelect.value : null;
      const chosen = notesList.find(n => String(n.id) === String(noteId)) || notesList[0];
      if (chosen) generateSummary(chosen);
    });
  }

  const retryBtn = document.getElementById('btnRetrySummary');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      const noteSelect = document.getElementById('summaryNoteSelect');
      const noteId = noteSelect ? noteSelect.value : null;
      const chosen = notesList.find(n => String(n.id) === String(noteId)) || notesList[0];
      if (chosen) generateSummary(chosen);
    });
  }

  const copyBtn = document.getElementById('btnCopySummary');
  if (copyBtn) copyBtn.addEventListener('click', copySummaryToClipboard);

  const downloadBtn = document.getElementById('btnDownloadSummary');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadSummaryAsFile);

  const quizBtn = document.getElementById('btnSummaryToQuiz');
  if (quizBtn) {
    quizBtn.addEventListener('click', () => {
      const noteSelect = document.getElementById('summaryNoteSelect');
      const noteId = noteSelect ? noteSelect.value : (notesList[0] ? notesList[0].id : 1);
      window.location.href = `quiz.html?noteId=${noteId}`;
    });
  }
}

/**
 * Calls backend /api/ai/summary with the selected note
 */
async function generateSummary(note) {
  if (!note) return;

  const processingCard = document.getElementById('aiProcessingCard');
  const resultsContainer = document.getElementById('summaryResultsContainer');
  const errorCard = document.getElementById('aiErrorCard');
  const errorTitle = document.getElementById('aiErrorTitle');
  const errorMessage = document.getElementById('aiErrorMessage');
  const sourceBadge = document.getElementById('summarySourceBadge');

  if (sourceBadge) {
    sourceBadge.innerHTML = `<i class="fa-solid fa-file-lines"></i> Source: <strong>${escapeHtml(note.title)}</strong> (${escapeHtml(note.subject)})`;
  }

  if (errorCard) errorCard.style.display = 'none';
  if (processingCard) processingCard.style.display = 'flex';
  if (resultsContainer) resultsContainer.style.display = 'none';

  try {
    const res = await fetch('/api/ai/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: note.id,
        title: note.title
      })
    });

    const data = await res.json();

    if (data.success && data.summary) {
      currentSummaryData = { title: note.title, subject: note.subject, ...data.summary };
      renderSummaryData(currentSummaryData);
      if (processingCard) processingCard.style.display = 'none';
      if (resultsContainer) resultsContainer.style.display = 'flex';
      showToast('AI Summary generated with Google Gemini.', 'success');
    } else {
      if (processingCard) processingCard.style.display = 'none';
      if (resultsContainer) resultsContainer.style.display = 'none';
      if (errorCard) {
        errorCard.style.display = 'block';
        if (data.configured === false) {
          if (errorTitle) errorTitle.textContent = 'Gemini API Key Required';
          if (errorMessage) errorMessage.textContent = 'AI features are not configured yet. Please configure GEMINI_API_KEY in your .env file.';
        } else {
          if (errorTitle) errorTitle.textContent = 'Could Not Generate Summary';
          if (errorMessage) errorMessage.textContent = data.error || 'The AI service could not summarize the document. Ensure it contains readable academic text.';
        }
      }
      showToast(data.error || 'Failed to generate AI summary.', 'danger');
    }
  } catch (err) {
    console.error('Summary API error:', err);
    if (processingCard) processingCard.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (errorCard) {
      errorCard.style.display = 'block';
      if (errorTitle) errorTitle.textContent = 'Network / Server Error';
      if (errorMessage) errorMessage.textContent = 'Could not reach the SmartNotes server. Please verify the application is running.';
    }
    showToast('Failed to contact AI service.', 'danger');
  }
}

function renderSummaryData(data) {
  const quickElem = document.getElementById('summaryQuickText');
  const pointsList = document.getElementById('summaryKeyPointsList');
  const defsGrid = document.getElementById('summaryDefsGrid');
  const examList = document.getElementById('summaryExamList');
  const keywordsCloud = document.getElementById('summaryKeywordsCloud');

  if (quickElem) quickElem.textContent = data.quickSummary;

  if (pointsList && data.keyPoints) {
    pointsList.innerHTML = data.keyPoints.map(pt => `
      <li>
        <i class="fa-solid fa-circle-check"></i>
        <span>${escapeHtml(pt)}</span>
      </li>
    `).join('');
  }

  if (defsGrid && data.definitions) {
    defsGrid.innerHTML = data.definitions.map(d => `
      <div class="def-card">
        <div class="def-term"><i class="fa-solid fa-bookmark"></i> ${escapeHtml(d.term)}</div>
        <p class="def-meaning">${escapeHtml(d.meaning)}</p>
      </div>
    `).join('');
  }

  if (examList && data.examRevision) {
    examList.innerHTML = data.examRevision.map(tip => `
      <li class="exam-tip-item">
        <i class="fa-solid fa-triangle-exclamation text-danger me-2"></i>
        <strong>Key Tip:</strong> ${escapeHtml(tip)}
      </li>
    `).join('');
  }

  if (keywordsCloud && data.keywords) {
    keywordsCloud.innerHTML = data.keywords.map(kw => `
      <span class="keyword-badge">#${escapeHtml(kw)}</span>
    `).join('');
  }
}

function copySummaryToClipboard() {
  if (!currentSummaryData) return;

  const text = `
=== SmartNotes AI Summary ===
Topic: ${currentSummaryData.title}
Subject: ${currentSummaryData.subject}

1. QUICK SUMMARY:
${currentSummaryData.quickSummary}

2. KEY POINTS:
${(currentSummaryData.keyPoints || []).map(p => `• ${p}`).join('\n')}

3. IMPORTANT DEFINITIONS:
${(currentSummaryData.definitions || []).map(d => `${d.term}: ${d.meaning}`).join('\n')}

4. EXAM REVISION POINTS:
${(currentSummaryData.examRevision || []).map(e => `• ${e}`).join('\n')}

5. KEYWORDS:
${(currentSummaryData.keywords || []).join(', ')}
  `.trim();

  navigator.clipboard.writeText(text).then(() => {
    showToast('Summary copied to clipboard.', 'success');
  }).catch(() => {
    showToast('Failed to copy.', 'danger');
  });
}

function downloadSummaryAsFile() {
  if (!currentSummaryData) return;

  const markdownContent = `# AI Note Summary: ${currentSummaryData.title}
**Subject:** ${currentSummaryData.subject}  
*Generated with SmartNotes AI Revision System*

---

## 1. Quick Summary
${currentSummaryData.quickSummary}

## 2. Key Points
${(currentSummaryData.keyPoints || []).map(p => `- ${p}`).join('\n')}

## 3. Important Definitions
${(currentSummaryData.definitions || []).map(d => `- **${d.term}**: ${d.meaning}`).join('\n')}

## 4. Exam Revision Checklist
${(currentSummaryData.examRevision || []).map(e => `- [ ] ${e}`).join('\n')}

## 5. Keywords
${(currentSummaryData.keywords || []).map(k => `\`#${k}\``).join(' ')}
`;

  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SmartNotes_Summary_${currentSummaryData.title.replace(/\s+/g, '_')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('Summary downloaded as Markdown file.', 'info');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * SmartNotes - Ask My Notes Client Module (public/js/ask.js)
 * Interactive document-grounded AI chat with source page citations,
 * real-time status polling, and retry handling.
 */

let currentDocument = null;
let conversationHistory = [];
let availableDocuments = [];
let pollTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initAskPage();
});

/**
 * Initializes the Ask My Notes page
 */
async function initAskPage() {
  const docSelect = document.getElementById('askDocSelect');
  const sendBtn = document.getElementById('btnSendQuestion');
  const input = document.getElementById('askQuestionInput');
  const clearBtn = document.getElementById('btnClearChatBtn');
  const retryBtn = document.getElementById('btnRetryFailedPages');

  // Load documents
  await loadDocuments();

  if (docSelect) {
    docSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      const found = availableDocuments.find(d => d.id === selectedId);
      if (found) {
        selectDocument(found);
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => submitQuestion());
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuestion();
      }
    });

    // Auto-adjust textarea height
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearChat();
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      if (currentDocument && currentDocument.fileId) {
        await retryFailedPages(currentDocument.fileId);
      }
    });
  }

  // Suggestion pill clicks
  document.addEventListener('click', (e) => {
    const pill = e.target.closest('.ask-suggestion-pill');
    if (pill && pill.dataset.prompt) {
      if (input) {
        input.value = pill.dataset.prompt;
        submitQuestion();
      }
    }
  });
}

/**
 * Loads documents from /api/ai/documents
 */
async function loadDocuments() {
  const docSelect = document.getElementById('askDocSelect');
  if (!docSelect) return;

  try {
    const res = await fetch('/api/ai/documents');
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.documents) && data.documents.length > 0) {
      availableDocuments = data.documents;

      docSelect.innerHTML = data.documents.map(d => {
        let label = d.title;
        if (d.status === 'processing') label += ' [Processing OCR...]';
        else if (d.status === 'failed') label += ' [OCR Failed]';
        else if (d.status === 'partially_failed') label += ' [Partially Processed]';

        return `<option value="${escapeHtml(d.id)}">${escapeHtml(label)} (${escapeHtml(d.subject)})</option>`;
      }).join('');

      // Check URL parameters for pre-selected document
      const params = new URLSearchParams(window.location.search);
      const urlFileId = params.get('fileId');
      const urlNoteId = params.get('noteId');

      let initialDoc = null;
      if (urlFileId) {
        initialDoc = availableDocuments.find(d => d.fileId == urlFileId);
      } else if (urlNoteId) {
        initialDoc = availableDocuments.find(d => d.noteId == urlNoteId);
      }

      if (!initialDoc) {
        // Default to first ready document, or simply the first document
        initialDoc = availableDocuments.find(d => d.isReady) || availableDocuments[0];
      }

      if (initialDoc) {
        docSelect.value = initialDoc.id;
        selectDocument(initialDoc);
      }
    } else {
      docSelect.innerHTML = '<option value="">No documents found</option>';
      showToast('No uploaded documents found. Please upload notes first.', 'info');
    }
  } catch (err) {
    console.error('Failed to load documents:', err);
    docSelect.innerHTML = '<option value="">Failed to load documents</option>';
  }
}

/**
 * Handles selecting an active document
 */
function selectDocument(doc) {
  currentDocument = doc;
  conversationHistory = [];

  // Stop any previous polling
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Update header info
  const titleElem = document.getElementById('askDocTitle');
  const subElem = document.getElementById('askDocSubtitle');
  const badgeElem = document.getElementById('askDocBadge');
  const iconElem = document.getElementById('askDocIcon');
  const warningBanner = document.getElementById('askDocWarning');
  const warningMsg = document.getElementById('askWarningMessage');
  const retryBtn = document.getElementById('btnRetryFailedPages');
  const input = document.getElementById('askQuestionInput');
  const sendBtn = document.getElementById('btnSendQuestion');

  if (titleElem) titleElem.textContent = doc.title;
  if (subElem) subElem.textContent = `${doc.subject} • ${doc.isOcr ? 'Scanned PDF (OCR)' : 'Text Document'}`;

  // Icon
  if (iconElem) {
    if (doc.title.endsWith('.docx') || doc.title.endsWith('.doc')) {
      iconElem.innerHTML = '<i class="fa-solid fa-file-word text-primary"></i>';
    } else if (doc.title.endsWith('.txt')) {
      iconElem.innerHTML = '<i class="fa-solid fa-file-lines text-secondary"></i>';
    } else {
      iconElem.innerHTML = '<i class="fa-solid fa-file-pdf text-danger"></i>';
    }
  }

  // Handle status states
  if (doc.status === 'processing') {
    if (badgeElem) {
      badgeElem.className = 'badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1';
      badgeElem.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Processing OCR';
    }
    if (warningBanner) warningBanner.style.display = 'flex';
    if (warningMsg) warningMsg.textContent = doc.statusMessage || 'This document is still processing OCR. Please wait until text extraction completes.';
    if (retryBtn) retryBtn.style.display = 'none';
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    // Start polling status until complete
    pollDocumentStatus(doc.fileId);
  } else if (doc.status === 'partially_failed') {
    if (badgeElem) {
      badgeElem.className = 'badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1';
      badgeElem.textContent = 'Partially Ready';
    }
    if (warningBanner) warningBanner.style.display = 'flex';
    if (warningMsg) warningMsg.textContent = doc.statusMessage || 'Some scanned pages could not be recognized. You can ask about readable pages, or retry failed pages.';
    if (retryBtn) retryBtn.style.display = 'inline-block';
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
  } else if (doc.status === 'failed') {
    if (badgeElem) {
      badgeElem.className = 'badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1';
      badgeElem.textContent = 'OCR Failed';
    }
    if (warningBanner) warningBanner.style.display = 'flex';
    if (warningMsg) warningMsg.textContent = doc.statusMessage || 'OCR processing failed on this document. No readable text is available.';
    if (retryBtn) retryBtn.style.display = doc.fileId ? 'inline-block' : 'none';
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
  } else {
    // Ready
    if (badgeElem) {
      badgeElem.className = 'badge bg-success-subtle text-success border border-success-subtle px-2 py-1';
      badgeElem.innerHTML = '<i class="fa-solid fa-check me-1"></i> Ready';
    }
    if (warningBanner) warningBanner.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'none';
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
  }

  // Render chat container
  renderChat();
}

/**
 * Polls status for processing documents
 */
function pollDocumentStatus(fileId) {
  if (!fileId) return;

  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/files/${fileId}/status`);
      const data = await res.json();

      if (res.ok && data.success) {
        const warningMsg = document.getElementById('askWarningMessage');
        if (warningMsg && data.message) {
          warningMsg.textContent = data.message;
        }

        if (data.status === 'ready' || data.status === 'completed') {
          clearInterval(pollTimer);
          pollTimer = null;
          showToast(`"${currentDocument.title}" OCR completed! Document is ready.`, 'success');
          await loadDocuments();
        } else if (data.status === 'failed' || data.status === 'partially_failed') {
          clearInterval(pollTimer);
          pollTimer = null;
          await loadDocuments();
        }
      }
    } catch (err) {
      console.warn('Status poll warning:', err);
    }
  }, 2500);
}

/**
 * Retries failed pages of a document
 */
async function retryFailedPages(fileId) {
  try {
    const res = await fetch(`/api/files/${fileId}/retry-ocr`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(data.message || 'Retry initiated for failed pages.', 'info');
      await loadDocuments();
    } else {
      showToast(data.error || 'Failed to retry pages.', 'danger');
    }
  } catch (err) {
    console.error('Retry error:', err);
    showToast('Failed to retry failed pages.', 'danger');
  }
}

/**
 * Renders the chat message list
 */
function renderChat() {
  const container = document.getElementById('askMessagesContainer');
  if (!container) return;

  if (conversationHistory.length === 0) {
    container.innerHTML = `
      <div class="ask-empty-state" id="askEmptyState">
        <div class="ask-empty-orb">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
        </div>
        <div class="ask-empty-title">Ask anything about "${escapeHtml(currentDocument ? currentDocument.title : 'your notes')}"</div>
        <div class="ask-empty-desc">
          SmartNotes grounds every answer directly in your uploaded notes and cites the exact source pages.
        </div>
        <div class="ask-suggestions-grid">
          <div class="ask-suggestion-pill" data-prompt="What are the key concepts and definitions covered in these notes?">
            <i class="fa-regular fa-lightbulb text-warning"></i> Key Concepts & Definitions
          </div>
          <div class="ask-suggestion-pill" data-prompt="Summarize the core exam takeaways and important formulas.">
            <i class="fa-solid fa-star text-primary"></i> High-Yield Exam Takeaways
          </div>
          <div class="ask-suggestion-pill" data-prompt="What are the primary differences or comparisons explained in this document?">
            <i class="fa-solid fa-scale-balanced text-info"></i> Core Comparisons
          </div>
          <div class="ask-suggestion-pill" data-prompt="Explain the main architecture or methodology described in this document.">
            <i class="fa-solid fa-diagram-project text-success"></i> Architecture & Methods
          </div>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = conversationHistory.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="ask-message-row user-row">
          <div class="ask-msg-avatar user-avatar-tag">YOU</div>
          <div class="ask-bubble">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    } else {
      let formatted = formatAiText(msg.text);
      let sourcesHtml = '';
      if (Array.isArray(msg.sources) && msg.sources.length > 0) {
        sourcesHtml = `
          <div class="ask-source-tags">
            <span class="text-muted" style="font-size: 0.75rem;"><i class="fa-solid fa-bookmark me-1"></i> Grounded in:</span>
            ${msg.sources.map(s => `<span class="ask-source-tag"><i class="fa-solid fa-file-lines"></i> ${escapeHtml(s)}</span>`).join('')}
          </div>
        `;
      }

      return `
        <div class="ask-message-row assistant-row">
          <div class="ask-msg-avatar ai-avatar-tag">
            <i class="fa-solid fa-brain"></i>
          </div>
          <div class="ask-bubble">
            ${formatted}
            ${sourcesHtml}
          </div>
        </div>
      `;
    }
  }).join('');

  scrollToBottom();
}

/**
 * Submits the student's question to /api/ai/ask
 */
async function submitQuestion() {
  const input = document.getElementById('askQuestionInput');
  const sendBtn = document.getElementById('btnSendQuestion');
  if (!input || !currentDocument) return;

  const question = input.value.trim();
  if (!question) return;

  if (!currentDocument.isReady && currentDocument.status === 'processing') {
    showToast('This document is still processing OCR. Please wait.', 'warning');
    return;
  }

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  // Add user message to conversation history
  conversationHistory.push({ role: 'user', text: question });
  renderChat();

  // Add thinking indicator
  showThinkingIndicator();

  // Disable send button while awaiting response
  if (sendBtn) sendBtn.disabled = true;
  if (input) input.disabled = true;

  try {
    const payload = {
      fileId: currentDocument.fileId || null,
      noteId: currentDocument.noteId || null,
      question: question,
      history: conversationHistory.slice(-6)
    };

    const res = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    removeThinkingIndicator();

    if (res.ok && data.success) {
      conversationHistory.push({
        role: 'model',
        text: data.answer,
        sources: data.sources || []
      });
      renderChat();
    } else {
      const errorMsg = data.error || 'Failed to generate answer. Please try again.';
      conversationHistory.push({
        role: 'model',
        text: `⚠️ **Note Assistant Notice:** ${errorMsg}`,
        sources: []
      });
      renderChat();
      showToast(errorMsg, 'danger');
    }
  } catch (err) {
    removeThinkingIndicator();
    console.error('Ask My Notes request error:', err);
    conversationHistory.push({
      role: 'model',
      text: '⚠️ **Network Error:** Could not connect to the SmartNotes AI service. Please check your internet connection and try again.',
      sources: []
    });
    renderChat();
    showToast('Connection failed. Please try again.', 'danger');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
  }
}

/**
 * Shows thinking indicator animation in chat
 */
function showThinkingIndicator() {
  const container = document.getElementById('askMessagesContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'ask-message-row assistant-row';
  row.id = 'askThinkingRow';
  row.innerHTML = `
    <div class="ask-msg-avatar ai-avatar-tag">
      <i class="fa-solid fa-brain"></i>
    </div>
    <div class="ask-thinking-bubble">
      <span class="ask-dot"></span>
      <span class="ask-dot"></span>
      <span class="ask-dot"></span>
      <span class="text-muted ms-2" style="font-size: 0.85rem;">Searching document pages & reasoning...</span>
    </div>
  `;
  container.appendChild(row);
  scrollToBottom();
}

/**
 * Removes thinking indicator
 */
function removeThinkingIndicator() {
  const row = document.getElementById('askThinkingRow');
  if (row) row.remove();
}

/**
 * Clears chat for current document
 */
function clearChat() {
  conversationHistory = [];
  renderChat();
  const input = document.getElementById('askQuestionInput');
  if (input) input.focus();
}

/**
 * Scrolls chat messages smoothly to bottom
 */
function scrollToBottom() {
  const container = document.getElementById('askMessagesContainer');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Formats AI markdown text safely into HTML
 */
function formatAiText(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);

  // Bold **text**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Bullet points
  escaped = escaped.replace(/^[•\-\*]\s+(.*)$/gm, '<li class="ms-3">$1</li>');

  // Numbered points
  escaped = escaped.replace(/^(\d+)\.\s+(.*)$/gm, '<li class="ms-3"><strong>$1.</strong> $2</li>');

  // Newlines to <br>
  escaped = escaped.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');

  return `<p class="mb-0">${escaped}</p>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

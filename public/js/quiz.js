/**
 * SmartNotes - AI Quiz Module (public/js/quiz.js)
 * Connects frontend quiz to backend /api/ai/quiz with Google Gemini API
 * and records score results to backend /api/ai/quiz-results.
 */

const DEFAULT_QUIZ_QUESTIONS = [
  {
    id: 1,
    question: "Which AWS service provides resizable virtual computing capacity in the cloud?",
    options: [
      "Amazon S3",
      "Amazon EC2",
      "Amazon RDS",
      "Amazon CloudFront"
    ],
    correctAnswer: 1,
    explanation: "Amazon EC2 (Elastic Compute Cloud) provides scalable virtual computing capacity in the AWS cloud, allowing users to launch and manage virtual server instances on demand."
  },
  {
    id: 2,
    question: "What is the primary characteristic of Amazon S3 storage?",
    options: [
      "Block-level volume storage mounted directly to an OS",
      "Relational SQL database engine for transaction processing",
      "Object-based storage designed for 99.999999999% data durability",
      "In-memory caching engine designed for microsecond responses"
    ],
    correctAnswer: 2,
    explanation: "Amazon Simple Storage Service (S3) is an object storage service that stores data as objects within buckets and provides 11 9's of durability."
  },
  {
    id: 3,
    question: "In Amazon EC2, what component acts as a stateful virtual firewall to control inbound and outbound network traffic?",
    options: [
      "Amazon Route 53",
      "Security Group",
      "Elastic Load Balancer",
      "AWS CloudWatch"
    ],
    correctAnswer: 1,
    explanation: "Security Groups act at the instance level as a virtual stateful firewall controlling which traffic can reach or leave your EC2 instances."
  },
  {
    id: 4,
    question: "What pre-configured template packages the operating system and software required to launch an EC2 instance?",
    options: [
      "AWS Lambda Function",
      "Amazon Machine Image (AMI)",
      "AWS Elastic Beanstalk",
      "AWS IAM Policy"
    ],
    correctAnswer: 1,
    explanation: "An Amazon Machine Image (AMI) provides the information required to launch an instance, including OS, web server, and application stack."
  },
  {
    id: 5,
    question: "Which Amazon S3 storage class is engineered specifically for lowest-cost long-term data archiving?",
    options: [
      "S3 Standard",
      "S3 One Zone-IA",
      "S3 Glacier Flexible Retrieval",
      "S3 Express One Zone"
    ],
    correctAnswer: 2,
    explanation: "Amazon S3 Glacier classes provide secure, durable, and low-cost storage for data archiving where instant access is not strictly required."
  }
];

let activeQuestions = DEFAULT_QUIZ_QUESTIONS;
let currentQuestionIndex = 0;
let userAnswers = {};
let currentNoteId = null;

document.addEventListener('DOMContentLoaded', () => {
  const currentPath = window.location.pathname.split('/').pop();

  if (currentPath === 'quiz.html') {
    initQuizPage();
  } else if (currentPath === 'quiz-result.html') {
    initQuizResultPage();
  }
});

// =============================================================================
// 1. Quiz Page Logic (quiz.html)
// =============================================================================

async function initQuizPage() {
  const urlParams = new URLSearchParams(window.location.search);
  currentNoteId = urlParams.get('noteId');

  userAnswers = {};
  currentQuestionIndex = 0;

  // Bind static buttons once
  const btnPrev = document.getElementById('btnQuizPrev');
  const btnNext = document.getElementById('btnQuizNext');
  const btnSubmit = document.getElementById('btnQuizSubmit');
  const btnRetry = document.getElementById('btnRetryQuiz');

  if (btnPrev) {
    btnPrev.onclick = () => {
      if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        renderCurrentQuestion();
      }
    };
  }

  if (btnNext) {
    btnNext.onclick = () => {
      if (currentQuestionIndex < activeQuestions.length - 1) {
        currentQuestionIndex++;
        renderCurrentQuestion();
      }
    };
  }

  if (btnSubmit) {
    btnSubmit.onclick = submitQuiz;
  }

  if (btnRetry) {
    btnRetry.onclick = () => loadQuiz();
  }

  await loadQuiz();
}

async function loadQuiz() {
  const loadingArea = document.getElementById('quizLoadingState');
  const errorArea = document.getElementById('quizErrorState');
  const activeArea = document.getElementById('quizActiveArea');
  const subjectBadge = document.getElementById('quizSubjectBadge');
  const topicBadge = document.getElementById('quizTopicBadge');
  const errorTitle = document.getElementById('quizErrorTitle');
  const errorMessage = document.getElementById('quizErrorMessage');

  if (loadingArea) loadingArea.style.display = 'block';
  if (errorArea) errorArea.style.display = 'none';
  if (activeArea) activeArea.style.display = 'none';

  userAnswers = {};
  currentQuestionIndex = 0;

  let activeNote = null;

  try {
    const notesRes = await fetch('/api/notes');
    const notesData = await notesRes.json();
    const notes = notesData.notes || [];

    if (currentNoteId) {
      activeNote = notes.find(n => String(n.id) === String(currentNoteId));
    }
    if (!activeNote && notes.length > 0) {
      activeNote = notes[0];
      currentNoteId = activeNote.id;
    }
  } catch (err) {
    console.warn('Failed to load notes for quiz metadata:', err);
  }

  if (activeNote) {
    if (subjectBadge) {
      subjectBadge.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(activeNote.subject || 'General')}`;
    }
    if (topicBadge) {
      topicBadge.textContent = `Topic: ${activeNote.title || 'Revision'}`;
    }
  }

  // Request real AI questions for this note
  try {
    const res = await fetch('/api/ai/quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: currentNoteId || (activeNote ? activeNote.id : null)
      })
    });

    const data = await res.json();

    if (data.success && Array.isArray(data.questions) && data.questions.length > 0) {
      activeQuestions = data.questions;
      if (loadingArea) loadingArea.style.display = 'none';
      if (activeArea) activeArea.style.display = 'block';
      renderDotsNav();
      renderCurrentQuestion();
      showToast('AI Revision Quiz generated with Google Gemini.', 'success');
    } else {
      if (loadingArea) loadingArea.style.display = 'none';
      if (errorArea) {
        errorArea.style.display = 'block';
        if (data.configured === false) {
          if (errorTitle) errorTitle.textContent = 'Gemini API Key Required';
          if (errorMessage) errorMessage.textContent = 'AI features are not configured yet. Please configure GEMINI_API_KEY in your .env file.';
        } else {
          if (errorTitle) errorTitle.textContent = 'Quiz Generation Failed';
          if (errorMessage) errorMessage.textContent = data.error || 'Could not generate quiz questions from this document. Ensure it contains readable academic text.';
        }
      }
      showToast(data.error || 'Failed to generate quiz.', 'danger');
    }
  } catch (err) {
    console.error('Quiz API error:', err);
    if (loadingArea) loadingArea.style.display = 'none';
    if (errorArea) {
      errorArea.style.display = 'block';
      if (errorTitle) errorTitle.textContent = 'Network / Server Error';
      if (errorMessage) errorMessage.textContent = 'Could not contact the SmartNotes AI service. Please verify the server is running.';
    }
    showToast('Failed to contact quiz service.', 'danger');
  }
}



function renderDotsNav() {
  const container = document.getElementById('quizDotsNav');
  if (!container) return;

  container.innerHTML = activeQuestions.map((q, idx) => {
    const isAnswered = userAnswers[idx] !== undefined;
    const isActive = idx === currentQuestionIndex;
    let classes = 'dot-nav-item';
    if (isActive) classes += ' active';
    else if (isAnswered) classes += ' answered';

    return `
      <div class="${classes}" onclick="jumpToQuestion(${idx})">
        ${idx + 1}
      </div>
    `;
  }).join('');
}

function jumpToQuestion(index) {
  if (index >= 0 && index < activeQuestions.length) {
    currentQuestionIndex = index;
    renderCurrentQuestion();
  }
}

function renderCurrentQuestion() {
  const total = activeQuestions.length;
  const q = activeQuestions[currentQuestionIndex];

  const counterElem = document.getElementById('quizCounterText');
  const progressFill = document.getElementById('quizProgressFill');
  const qTitleElem = document.getElementById('quizQuestionTitle');
  const optionsContainer = document.getElementById('quizOptionsContainer');
  const btnPrev = document.getElementById('btnQuizPrev');
  const btnNext = document.getElementById('btnQuizNext');
  const btnSubmit = document.getElementById('btnQuizSubmit');

  if (counterElem) counterElem.textContent = `Question ${currentQuestionIndex + 1} of ${total}`;

  const percent = Math.round(((currentQuestionIndex + 1) / total) * 100);
  if (progressFill) progressFill.style.width = `${percent}%`;

  if (qTitleElem) qTitleElem.textContent = q.question;

  if (optionsContainer) {
    const optionLetters = ['A', 'B', 'C', 'D'];
    optionsContainer.innerHTML = q.options.map((optText, optIdx) => {
      const isSelected = userAnswers[currentQuestionIndex] === optIdx;
      return `
        <div class="option-item ${isSelected ? 'selected' : ''}" onclick="selectOption(${optIdx})">
          <div class="option-indicator">${optionLetters[optIdx]}</div>
          <div class="option-text">${escapeHtml(optText)}</div>
          ${isSelected ? '<i class="fa-solid fa-circle-check text-primary ms-auto"></i>' : ''}
        </div>
      `;
    }).join('');
  }

  if (btnPrev) btnPrev.disabled = currentQuestionIndex === 0;

  if (btnNext && btnSubmit) {
    if (currentQuestionIndex === total - 1) {
      btnNext.style.display = 'none';
      btnSubmit.style.display = 'inline-flex';
    } else {
      btnNext.style.display = 'inline-flex';
      btnSubmit.style.display = 'none';
    }
  }

  renderDotsNav();
}

function selectOption(optionIndex) {
  userAnswers[currentQuestionIndex] = optionIndex;
  renderCurrentQuestion();
}

async function submitQuiz() {
  const total = activeQuestions.length;
  const answeredCount = Object.keys(userAnswers).length;

  if (answeredCount < total) {
    if (!confirm(`You have answered ${answeredCount} of ${total} questions. Are you sure you want to submit?`)) {
      return;
    }
  }

  // Calculate Score
  let correctCount = 0;
  activeQuestions.forEach((q, idx) => {
    if (userAnswers[idx] === q.correctAnswer) {
      correctCount++;
    }
  });

  const percentage = Math.round((correctCount / total) * 100);

  const quizResultData = {
    score: correctCount,
    total: total,
    percentage: percentage,
    userAnswers: userAnswers,
    questions: activeQuestions,
    date: new Date().toISOString()
  };

  localStorage.setItem('smartnotes_last_quiz_result', JSON.stringify(quizResultData));

  // Save to backend database
  try {
    await fetch('/api/ai/quiz-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: currentNoteId,
        score: correctCount,
        totalQuestions: total,
        percentage: percentage
      })
    });
  } catch (err) {
    console.warn('Could not save quiz result to database:', err);
  }

  showToast('Quiz submitted successfully!', 'success');
  setTimeout(() => {
    window.location.href = 'quiz-result.html';
  }, 600);
}

// =============================================================================
// 2. Quiz Result Page Logic (quiz-result.html)
// =============================================================================

function initQuizResultPage() {
  const resultJson = localStorage.getItem('smartnotes_last_quiz_result');
  let result;

  if (resultJson) {
    try {
      result = JSON.parse(resultJson);
    } catch (e) {
      result = { score: 4, total: 5, percentage: 80, userAnswers: { 0: 1, 1: 2, 2: 1, 3: 1, 4: 0 }, questions: DEFAULT_QUIZ_QUESTIONS };
    }
  } else {
    result = { score: 4, total: 5, percentage: 80, userAnswers: { 0: 1, 1: 2, 2: 1, 3: 1, 4: 0 }, questions: DEFAULT_QUIZ_QUESTIONS };
  }

  const scoreElem = document.getElementById('resultScoreDisplay');
  const percentElem = document.getElementById('resultPercentageDisplay');
  const msgElem = document.getElementById('resultPerformanceMessage');
  const correctElem = document.getElementById('statCorrectCount');
  const incorrectElem = document.getElementById('statIncorrectCount');
  const accuracyElem = document.getElementById('statAccuracyRate');

  if (scoreElem) scoreElem.textContent = `${result.score} / ${result.total}`;
  if (percentElem) percentElem.textContent = `${result.percentage}% Score`;

  const incorrectCount = result.total - result.score;
  if (correctElem) correctElem.textContent = result.score;
  if (incorrectElem) incorrectElem.textContent = incorrectCount;
  if (accuracyElem) accuracyElem.textContent = `${result.percentage}%`;

  if (msgElem) {
    if (result.percentage >= 80) {
      msgElem.textContent = "Great work! You have a strong grasp of AWS Cloud infrastructure. Review the missed topics below and try again.";
    } else if (result.percentage >= 60) {
      msgElem.textContent = "Good effort! You passed, but reviewing key concepts will help solidify your exam readiness.";
    } else {
      msgElem.textContent = "Keep practicing! Review your notes and generate an AI summary before attempting again.";
    }
  }

  renderReviewSection(result.userAnswers, result.questions || DEFAULT_QUIZ_QUESTIONS);
}

function renderReviewSection(answers, questions) {
  const container = document.getElementById('quizReviewContainer');
  if (!container) return;

  const optionLetters = ['A', 'B', 'C', 'D'];

  container.innerHTML = questions.map((q, idx) => {
    const userChoice = answers[idx];
    const isCorrect = userChoice === q.correctAnswer;
    const statusClass = isCorrect ? 'is-correct' : 'is-incorrect';
    const statusIcon = isCorrect
      ? '<span class="badge bg-success-subtle text-success px-2 py-1"><i class="fa-solid fa-check"></i> Correct</span>'
      : '<span class="badge bg-danger-subtle text-danger px-2 py-1"><i class="fa-solid fa-xmark"></i> Incorrect</span>';

    const userSelectedText = userChoice !== undefined && q.options[userChoice]
      ? `${optionLetters[userChoice]}. ${q.options[userChoice]}`
      : 'Not answered';

    const correctText = `${optionLetters[q.correctAnswer]}. ${q.options[q.correctAnswer]}`;

    return `
      <div class="review-item ${statusClass}">
        <div class="review-q-header">
          <span class="font-weight-700 text-muted" style="font-size: 0.85rem;">Question ${idx + 1} of ${questions.length}</span>
          ${statusIcon}
        </div>
        <h5 class="mb-3 font-weight-700" style="font-size: 1.05rem;">${escapeHtml(q.question)}</h5>
        <div class="mb-2" style="font-size: 0.925rem;">
          <strong>Your Answer:</strong> 
          <span class="${isCorrect ? 'text-success font-weight-600' : 'text-danger font-weight-600'}">
            ${escapeHtml(userSelectedText)}
          </span>
        </div>
        ${!isCorrect ? `
          <div class="mb-2 text-success font-weight-600" style="font-size: 0.925rem;">
            <strong>Correct Answer:</strong> ${escapeHtml(correctText)}
          </div>
        ` : ''}
        <div class="review-explanation">
          <i class="fa-solid fa-lightbulb text-warning me-1"></i>
          <strong>Explanation:</strong> ${escapeHtml(q.explanation)}
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

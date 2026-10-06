/**
 * SmartNotes - Authentication Module (public/js/auth.js)
 * Connects frontend Login and Registration forms to the Express REST API (/api/auth).
 */

document.addEventListener('DOMContentLoaded', () => {
  // Password Visibility Toggle Handler
  const togglePassButtons = document.querySelectorAll('.input-password-toggle');
  togglePassButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target') || 'loginPassword';
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
          }
        } else {
          input.type = 'password';
          if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
          }
        }
      }
    });
  });

  // Demo Credentials Auto-Fill
  const fillDemoBtn = document.getElementById('fillDemoCredentials');
  if (fillDemoBtn) {
    fillDemoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('loginEmail');
      const passInput = document.getElementById('loginPassword');
      if (emailInput) emailInput.value = 'student@smartnotes.demo';
      if (passInput) passInput.value = 'student123';
      showToast('Demo credentials filled: student@smartnotes.demo', 'info');
    });
  }

  // Login Form Submission Handler
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLogin();
    });
  }

  // Register Form Submission Handler
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleRegister();
    });
  }
});

/**
 * Handles login via backend API
 */
async function handleLogin() {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  let isValid = true;

  clearErrors();

  if (!emailInput.value.trim()) {
    showError(emailInput, 'Please enter your student email address.');
    isValid = false;
  } else if (!isValidEmail(emailInput.value.trim())) {
    showError(emailInput, 'Please enter a valid email address.');
    isValid = false;
  }

  if (!passInput.value) {
    showError(passInput, 'Please enter your password.');
    isValid = false;
  }

  if (!isValid) return;

  const submitBtn = document.getElementById('loginSubmitBtn');
  const originalText = submitBtn ? submitBtn.innerHTML : 'Sign In';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Signing in...';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: emailInput.value.trim(),
        password: passInput.value
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(passInput, data.error || 'Invalid email or password.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
      return;
    }

    // Save profile to localStorage for instant UI responsiveness
    if (data.user) {
      localStorage.setItem('smartnotes_user', JSON.stringify(data.user));
    }

    showToast(`Welcome back, ${data.user.name}!`, 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 700);
  } catch (err) {
    console.error('Login error:', err);
    showError(passInput, 'Connection error. Please ensure the server is running.');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

/**
 * Handles registration via backend API
 */
async function handleRegister() {
  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const collegeInput = document.getElementById('regCollege');
  const passInput = document.getElementById('regPassword');
  const confirmPassInput = document.getElementById('regConfirmPassword');

  clearErrors();
  let isValid = true;

  if (!nameInput.value.trim()) {
    showError(nameInput, 'Full name is required.');
    isValid = false;
  }

  if (!emailInput.value.trim()) {
    showError(emailInput, 'Email address is required.');
    isValid = false;
  } else if (!isValidEmail(emailInput.value.trim())) {
    showError(emailInput, 'Please enter a valid college email address.');
    isValid = false;
  }

  if (!collegeInput.value.trim()) {
    showError(collegeInput, 'College / University name is required.');
    isValid = false;
  }

  if (!passInput.value) {
    showError(passInput, 'Password is required.');
    isValid = false;
  } else if (passInput.value.length < 6) {
    showError(passInput, 'Password must be at least 6 characters.');
    isValid = false;
  }

  if (!confirmPassInput.value) {
    showError(confirmPassInput, 'Please confirm your password.');
    isValid = false;
  } else if (confirmPassInput.value !== passInput.value) {
    showError(confirmPassInput, 'Passwords do not match.');
    isValid = false;
  }

  if (!isValid) return;

  const submitBtn = document.getElementById('registerSubmitBtn');
  const originalText = submitBtn ? submitBtn.innerHTML : 'Create Account';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Creating account...';
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        college: collegeInput.value.trim(),
        password: passInput.value
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showError(emailInput, data.error || 'Registration failed.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
      return;
    }

    if (data.user) {
      localStorage.setItem('smartnotes_user', JSON.stringify(data.user));
    }

    showToast('Account created successfully! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 800);
  } catch (err) {
    console.error('Registration error:', err);
    showError(emailInput, 'Connection error. Please ensure the server is running.');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

function showError(inputElem, message) {
  const formGroup = inputElem.closest('.form-group');
  if (formGroup) {
    formGroup.classList.add('has-error');
    let errElem = formGroup.querySelector('.form-error-msg');
    if (!errElem) {
      errElem = document.createElement('div');
      errElem.className = 'form-error-msg';
      formGroup.appendChild(errElem);
    }
    errElem.textContent = message;
    errElem.style.display = 'block';
  }
}

function clearErrors() {
  document.querySelectorAll('.form-group').forEach(group => {
    group.classList.remove('has-error');
    const err = group.querySelector('.form-error-msg');
    if (err) err.style.display = 'none';
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * SmartNotes - Profile & Settings Module (public/js/profile.js)
 * Loads student profile and academic metrics from backend Express API
 * and handles profile editing and password updates.
 */

document.addEventListener('DOMContentLoaded', () => {
  renderProfilePage();
  initProfileModals();
});

async function renderProfilePage() {
  try {
    // 1. Fetch User Profile
    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData.success && meData.user) {
        populateProfileFields(meData.user);
      }
    }

    // 2. Fetch User Stats
    const statsRes = await fetch('/api/notes/stats/dashboard');
    if (statsRes.ok) {
      const statsData = await statsRes.json();
      if (statsData.success && statsData.stats) {
        const statNotes = document.getElementById('profileStatNotes');
        const statSubjects = document.getElementById('profileStatSubjects');
        const statQuizzes = document.getElementById('profileStatQuizzes');

        if (statNotes) statNotes.textContent = statsData.stats.totalNotes;
        if (statSubjects) statSubjects.textContent = statsData.stats.totalSubjects;
        if (statQuizzes) statQuizzes.textContent = statsData.stats.quizzesCompleted;
      }
    }
  } catch (err) {
    console.error('Profile fetch error:', err);
  }
}

function populateProfileFields(user) {
  const nameElems = document.querySelectorAll('.student-name-display');
  const emailElems = document.querySelectorAll('.student-email-display');
  const collegeElem = document.getElementById('profileCollege');
  const courseElem = document.getElementById('profileCourse');
  const yearElem = document.getElementById('profileYear');
  const avatarInitials = document.querySelectorAll('.student-avatar-initials');

  nameElems.forEach(el => el.textContent = user.name || 'Alex Student');
  emailElems.forEach(el => el.textContent = user.email || 'student@smartnotes.demo');

  if (collegeElem) collegeElem.textContent = user.college || 'AISSMS College of Engineering';
  if (courseElem) courseElem.textContent = user.course || 'Computer Engineering';
  if (yearElem) yearElem.textContent = user.year || 'Third Year (Semester 5)';

  const initials = user.name
    ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    : 'AS';

  avatarInitials.forEach(el => el.textContent = initials);
}

function initProfileModals() {
  // Pre-fill Edit Profile Form
  const editProfileForm = document.getElementById('editProfileForm');
  if (editProfileForm) {
    // When modal opens, pre-fill from current elements
    const editModal = document.getElementById('editProfileModal');
    if (editModal) {
      editModal.addEventListener('show.bs.modal', async () => {
        try {
          const res = await fetch('/api/auth/me');
          const data = await res.json();
          if (data.user) {
            const editName = document.getElementById('editProfileName');
            const editEmail = document.getElementById('editProfileEmail');
            const editCollege = document.getElementById('editProfileCollege');
            const editCourse = document.getElementById('editProfileCourse');
            const editYear = document.getElementById('editProfileYear');

            if (editName) editName.value = data.user.name || '';
            if (editEmail) editEmail.value = data.user.email || '';
            if (editCollege) editCollege.value = data.user.college || '';
            if (editCourse) editCourse.value = data.user.course || '';
            if (editYear) editYear.value = data.user.year || '';
          }
        } catch (e) {}
      });
    }

    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editName = document.getElementById('editProfileName');
      const editCollege = document.getElementById('editProfileCollege');
      const editCourse = document.getElementById('editProfileCourse');
      const editYear = document.getElementById('editProfileYear');

      try {
        const res = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName ? editName.value.trim() : undefined,
            college: editCollege ? editCollege.value.trim() : undefined,
            course: editCourse ? editCourse.value.trim() : undefined,
            year: editYear ? editYear.value.trim() : undefined
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Profile updated successfully in database.', 'success');
          if (data.user) {
            localStorage.setItem('smartnotes_user', JSON.stringify(data.user));
            populateProfileFields(data.user);
          }

          const modalElem = document.getElementById('editProfileModal');
          if (modalElem && window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalElem);
            if (modal) modal.hide();
          }
        } else {
          showToast(data.error || 'Failed to update profile.', 'danger');
        }
      } catch (err) {
        console.error('Update profile error:', err);
        showToast('Error updating profile.', 'danger');
      }
    });
  }

  // Change Password Form
  const changePassForm = document.getElementById('changePasswordForm');
  if (changePassForm) {
    changePassForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPass = document.getElementById('currentPassword');
      const newPass = document.getElementById('newPassword');
      const confirmPass = document.getElementById('confirmNewPassword');

      if (!currentPass.value || !newPass.value) {
        showToast('Please fill in all password fields.', 'danger');
        return;
      }

      if (newPass.value.length < 6) {
        showToast('New password must be at least 6 characters.', 'warning');
        return;
      }

      if (newPass.value !== confirmPass.value) {
        showToast('New passwords do not match.', 'danger');
        return;
      }

      try {
        const res = await fetch('/api/auth/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: currentPass.value,
            newPassword: newPass.value
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showToast('Password changed successfully.', 'success');
          changePassForm.reset();

          const modalElem = document.getElementById('changePasswordModal');
          if (modalElem && window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalElem);
            if (modal) modal.hide();
          }
        } else {
          showToast(data.error || 'Failed to change password.', 'danger');
        }
      } catch (err) {
        console.error('Change pass error:', err);
        showToast('Error changing password.', 'danger');
      }
    });
  }
}

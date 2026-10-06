/**
 * SmartNotes - Authentication Routes (routes/auth.js)
 * User registration, login, logout, and profile management with bcrypt and express-session.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
  }
  next();
}

/**
 * POST /api/auth/register
 * Registers a new student account
 */
router.post('/register', (req, res) => {
  try {
    const { name, email, password, college, course, year } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    const stmt = db.prepare(`
      INSERT INTO users (name, email, password_hash, college, course, year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name.trim(),
      cleanEmail,
      passwordHash,
      college ? college.trim() : 'College of Engineering',
      course ? course.trim() : 'Computer Engineering',
      year ? year.trim() : 'Third Year'
    );

    // Set session
    req.session.userId = result.lastInsertRowid;

    const user = db.prepare('SELECT id, name, email, college, course, year, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      user
    });
  } catch (err) {
    console.error('[Auth] Registration error:', err);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Signs in user with email & password
 */
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    // Set session
    req.session.userId = user.id;

    const sanitizedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      college: user.college,
      course: user.course,
      year: user.year,
      created_at: user.created_at
    };

    return res.json({
      success: true,
      message: 'Signed in successfully.',
      user: sanitizedUser
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ success: false, error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/logout
 * Logs out user by destroying session
 */
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Could not log out.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ success: true, message: 'Logged out successfully.' });
  });
});

/**
 * GET /api/auth/me
 * Retrieves current logged-in user profile
 */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, user: null });
  }

  const user = db.prepare('SELECT id, name, email, college, course, year, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(401).json({ success: false, user: null });
  }

  return res.json({ success: true, user });
});

/**
 * PUT /api/auth/profile
 * Updates student profile information
 */
router.put('/profile', requireAuth, (req, res) => {
  try {
    const { name, college, course, year } = req.body;
    const userId = req.session.userId;

    const stmt = db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          college = COALESCE(?, college),
          course = COALESCE(?, course),
          year = COALESCE(?, year)
      WHERE id = ?
    `);

    stmt.run(name, college, course, year, userId);
    const updated = db.prepare('SELECT id, name, email, college, course, year, created_at FROM users WHERE id = ?').get(userId);

    return res.json({ success: true, message: 'Profile updated successfully.', user: updated });
  } catch (err) {
    console.error('[Auth] Profile update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update profile.' });
  }
});

/**
 * PUT /api/auth/password
 * Changes student password
 */
router.put('/password', requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
    }

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[Auth] Password change error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update password.' });
  }
});

module.exports = {
  router,
  requireAuth
};

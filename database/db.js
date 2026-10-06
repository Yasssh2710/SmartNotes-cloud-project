/**
 * SmartNotes - Database Module (database/db.js)
 * SQLite database setup and automatic table initialization using better-sqlite3.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Ensure database directory exists
const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'smartnotes.db');
const db = new Database(dbPath);

// Enable foreign key support
db.pragma('foreign_keys = ON');

function initDatabase() {
  // 1. Create USERS table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      college TEXT,
      course TEXT,
      year TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Create NOTES table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      topic TEXT,
      tags TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. Create FILES table
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      note_id INTEGER,
      original_filename TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
    );
  `);

  // 4. Create QUIZ_RESULTS table
  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      note_id INTEGER,
      score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      percentage INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
    );
  `);

  // 5. Create SUBJECTS table
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      semester TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Schema Migrations (add columns if missing)
  migrateSchema();

  // 7. Seed default demo user and curriculum data if not exists
  seedDemoData();
}

function migrateSchema() {
  try {
    const fileCols = db.prepare('PRAGMA table_info(files)').all().map(c => c.name);
    if (!fileCols.includes('subject')) {
      db.exec('ALTER TABLE files ADD COLUMN subject TEXT;');
    }
    if (!fileCols.includes('extracted_text')) {
      db.exec('ALTER TABLE files ADD COLUMN extracted_text TEXT;');
    }

    const noteCols = db.prepare('PRAGMA table_info(notes)').all().map(c => c.name);
    if (!noteCols.includes('file_id')) {
      db.exec('ALTER TABLE notes ADD COLUMN file_id INTEGER;');
    }
  } catch (err) {
    console.warn('[DB Migration Warning]', err.message);
  }
}

function seedDemoData() {
  const demoEmail = 'student@smartnotes.demo';
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(demoEmail);

  let userId;
  if (!existingUser) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('student123', salt);

    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, college, course, year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = insertUser.run(
      'Alex Student',
      demoEmail,
      passwordHash,
      'AISSMS College of Engineering',
      'Computer Engineering',
      'Third Year'
    );
    userId = result.lastInsertRowid;
    console.log(`[DB] Created default demo user (${demoEmail}) with ID: ${userId}`);
  } else {
    userId = existingUser.id;
  }

  // Seed sample notes if user has no notes
  const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes WHERE user_id = ?').get(userId);
  if (noteCount.count === 0) {
    const insertNote = db.prepare(`
      INSERT INTO notes (user_id, title, subject, topic, tags, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const sampleNotes = [
      {
        title: 'AWS EC2 and S3 Basics',
        subject: 'Cloud Computing',
        topic: 'Compute & Storage Architecture',
        tags: 'AWS, EC2, S3, Cloud',
        content: `<h2>1. Introduction to Amazon EC2</h2>
<p>Amazon Elastic Compute Cloud (Amazon EC2) provides scalable computing capacity in the Amazon Web Services (AWS) cloud. Using Amazon EC2 eliminates your need to invest in hardware up front, so you can develop and deploy applications faster.</p>
<p>You can use Amazon EC2 to launch as many or as few virtual servers as you need, configure security and networking, and manage storage. Amazon EC2 enables you to scale up or down to handle changes in requirements or spikes in popularity.</p>

<h3>Key Concepts of EC2</h3>
<ul>
  <li><strong>Amazon Machine Images (AMIs):</strong> Pre-configured templates for your instances that package the bits needed for your server.</li>
  <li><strong>Instance Types:</strong> Various CPU, memory, storage, and networking capacity combinations tailored for compute, memory, or storage optimization.</li>
  <li><strong>Security Groups:</strong> Act as a virtual firewall for your instance to control inbound and outbound traffic.</li>
  <li><strong>Elastic IP Addresses:</strong> Static IPv4 addresses designed for dynamic cloud computing.</li>
</ul>

<h2>2. Introduction to Amazon S3</h2>
<p>Amazon Simple Storage Service (Amazon S3) is an object storage service that offers industry-leading scalability, data availability, security, and performance.</p>

<h3>Core S3 Concepts</h3>
<ul>
  <li><strong>Buckets:</strong> Containers for data stored in Amazon S3. Every object is contained in a bucket with a globally unique name.</li>
  <li><strong>Objects:</strong> The fundamental entities stored in Amazon S3, consisting of object data and metadata.</li>
  <li><strong>Storage Classes:</strong> S3 Standard, S3 Intelligent-Tiering, S3 Standard-IA, and S3 Glacier for cost optimization.</li>
</ul>`
      },
      {
        title: 'Database Normalization (1NF, 2NF, 3NF, BCNF)',
        subject: 'DBMS',
        topic: 'Relational Schema Design',
        tags: 'DBMS, SQL, Normalization, Relational',
        content: `<h2>What is Normalization?</h2>
<p>Database normalization is a systematic approach of decomposing tables to eliminate data redundancy and undesirable characteristics like Insertion, Update, and Deletion Anomalies.</p>

<h3>Normal Forms Hierarchy</h3>
<ol>
  <li><strong>First Normal Form (1NF):</strong> Each column must contain atomic (indivisible) values, and each record must be unique.</li>
  <li><strong>Second Normal Form (2NF):</strong> Must be in 1NF and have NO partial dependency.</li>
  <li><strong>Third Normal Form (3NF):</strong> Must be in 2NF and have NO transitive dependency for non-prime attributes.</li>
  <li><strong>Boyce-Codd Normal Form (BCNF):</strong> A stricter 3NF where for every functional dependency X → Y, X must be a super key.</li>
</ol>`
      },
      {
        title: 'OSI Model & TCP/IP Architecture',
        subject: 'Computer Networks',
        topic: 'Network Layered Models',
        tags: 'Networks, OSI, TCP/IP, Protocols',
        content: `<h2>The 7 Layers of OSI</h2>
<p>The Open Systems Interconnection (OSI) model describes seven layers that computer systems use to communicate over a network:</p>
<ul>
  <li><strong>Layer 7 - Application:</strong> HTTP, FTP, SMTP, DNS. End-user interface.</li>
  <li><strong>Layer 6 - Presentation:</strong> Data translation, SSL/TLS encryption, compression.</li>
  <li><strong>Layer 5 - Session:</strong> Session checkpointing, authentication, authorization.</li>
  <li><strong>Layer 4 - Transport:</strong> TCP (reliable, segment) and UDP (unreliable, datagram). Flow and error control.</li>
  <li><strong>Layer 3 - Network:</strong> IP addressing, routing packets across networks.</li>
  <li><strong>Layer 2 - Data Link:</strong> MAC addressing, framing, hop-to-hop delivery.</li>
  <li><strong>Layer 1 - Physical:</strong> Transmission of raw bit streams over physical medium.</li>
</ul>`
      },
      {
        title: 'Introduction to Machine Learning',
        subject: 'Artificial Intelligence',
        topic: 'Supervised & Unsupervised Learning',
        tags: 'AI, ML, Regression, Classification',
        content: `<h2>What is Machine Learning?</h2>
<p>Machine learning is a subfield of artificial intelligence that gives computers the ability to learn and make decisions from data without being explicitly programmed.</p>
<h3>Types of Machine Learning</h3>
<ul>
  <li><strong>Supervised Learning:</strong> Labeled data used for Classification and Regression.</li>
  <li><strong>Unsupervised Learning:</strong> Unlabeled data used for Clustering (K-Means) and Dimensionality Reduction (PCA).</li>
  <li><strong>Reinforcement Learning:</strong> Agent learns actions in an environment to maximize cumulative reward.</li>
</ul>`
      },
      {
        title: 'Process Management and CPU Scheduling',
        subject: 'Operating Systems',
        topic: 'Process Control Block & Algorithms',
        tags: 'OS, Processes, Scheduling, Threads',
        content: `<h2>Process vs Program</h2>
<p>A program is passive code stored on disk, whereas a process is an active program in execution with a program counter, registers, and memory stack.</p>
<h3>CPU Scheduling Algorithms</h3>
<ul>
  <li><strong>First-Come, First-Served (FCFS):</strong> Non-preemptive, suffers from Convoy Effect.</li>
  <li><strong>Shortest Job First (SJF):</strong> Optimal average waiting time.</li>
  <li><strong>Round Robin (RR):</strong> Preemptive algorithm using a fixed time quantum.</li>
</ul>`
      },
      {
        title: 'Searching and Sorting Algorithms',
        subject: 'Data Structures',
        topic: 'Time Complexity & Implementations',
        tags: 'DSA, Binary Search, QuickSort, MergeSort',
        content: `<h2>Asymptotic Notation and Sorting</h2>
<p>Sorting algorithms organize elements in a specified order. Efficiency is evaluated using Big O notation.</p>
<h3>Comparison of Major Algorithms</h3>
<ul>
  <li><strong>Merge Sort:</strong> Divide and conquer, stable, O(N log N) in all cases, requires O(N) auxiliary space.</li>
  <li><strong>Quick Sort:</strong> In-place partitioning, average O(N log N), worst case O(N^2).</li>
  <li><strong>Binary Search:</strong> Requires sorted array, divides search interval in half every step, O(log N) time.</li>
</ul>`
      }
    ];

    const insertMany = db.transaction((notes) => {
      for (const n of notes) {
        insertNote.run(userId, n.title, n.subject, n.topic, n.tags, n.content);
      }
    });

    insertMany(sampleNotes);
    console.log(`[DB] Seeded ${sampleNotes.length} initial academic notes for demo user.`);
  }

  // Seed sample quiz results if none exist
  const quizCount = db.prepare('SELECT COUNT(*) as count FROM quiz_results WHERE user_id = ?').get(userId);
  if (quizCount.count === 0) {
    const insertQuiz = db.prepare(`
      INSERT INTO quiz_results (user_id, note_id, score, total_questions, percentage)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertQuiz.run(userId, 1, 4, 5, 80);
    console.log('[DB] Seeded sample quiz result for demo user.');
  }

  // Seed default subjects if not already seeded
  const defaultSubjects = [
    { name: 'Cloud Computing', semester: '5', description: 'AWS architecture, EC2 instances, S3 object storage, virtualization, Docker containers, and cloud deployment models.' },
    { name: 'DBMS', semester: '4', description: 'Relational schema design, Normalization (1NF to BCNF), SQL joins, indexing, and ACID transaction properties.' },
    { name: 'Computer Networks', semester: '5', description: 'OSI 7-layer model, TCP/IP stack, IP addressing, routing protocols, switching, and socket programming.' },
    { name: 'Artificial Intelligence', semester: '6', description: 'Search algorithms, Knowledge representation, Supervised and Unsupervised Machine Learning, Neural Networks.' },
    { name: 'Operating Systems', semester: '4', description: 'Process management, CPU scheduling, Memory virtualization, Deadlocks, File systems, and Paging.' },
    { name: 'Data Structures', semester: '3', description: 'Arrays, Linked Lists, Stacks, Queues, Binary Trees, Graphs, Sorting, and Algorithm Complexity.' }
  ];

  const insertSubject = db.prepare(`
    INSERT OR IGNORE INTO subjects (user_id, name, description, semester)
    VALUES (?, ?, ?, ?)
  `);

  for (const s of defaultSubjects) {
    insertSubject.run(null, s.name, s.description, s.semester);
  }
}

// Initialize tables on load
initDatabase();

module.exports = db;

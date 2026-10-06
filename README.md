# SmartNotes: Smart Cloud-Based Study Notes & Revision System

> **Tagline:** *"Store. Understand. Revise."*  
> **Project Type:** College Cloud Computing Mini Project  
> **Target Audience:** Engineering & College Students  
> **Stack:** HTML5, CSS3, Vanilla JavaScript, Node.js, Express.js, SQLite, Google Gemini API, Amazon S3, Docker, AWS EC2  

---

## 1. Project Title & Problem Statement

### Title
**SmartNotes — Smart Cloud-Based Study Notes & Revision System**

### Problem Statement
College engineering students handle voluminous study material across multiple rigorous subjects (Cloud Computing, Database Management Systems, Computer Networks, Operating Systems, Artificial Intelligence, and Data Structures). 

Traditional cloud storage systems (like Google Drive or Dropbox) act merely as passive storage bins where students *Upload, Store, and Download*. They lack pedagogical structure:
- Notes are disorganized across folders without academic subject tagging.
- Reading through 20-page lecture slides the night before exams is inefficient and overwhelming.
- Students have no built-in way to self-assess their retention or practice syllabus-aligned exam questions.

### The SmartNotes Solution
SmartNotes turns passive document storage into an active, intelligent learning loop:

$$\text{Store} \longrightarrow \text{Organize} \longrightarrow \text{Understand} \longrightarrow \text{Summarize (AI)} \longrightarrow \text{Revise} \longrightarrow \text{Test (AI Quiz)}$$

The platform features two central AI-assisted tools:
1. **AI Note Summary:** Automatically analyzes long study notes and outputs 5 structured revision sections (Quick Summary, Key Points, Important Definitions, Exam Revision Checklist, and Keywords).
2. **AI Revision Quiz:** Auto-generates 5 syllabus-aligned multiple choice questions (MCQs) with real-time scoring, percentage metrics, and in-depth explanations for every answer.

---

## 2. Project Objectives

- **Centralized Dashboard:** A professional academic workspace displaying real-time statistics (Total Notes, Subjects, Uploaded Files, Quizzes Completed) and recent study notes.
- **Subject-Wise Curriculum Organization:** Pre-configured catalogs for core Computer Engineering subjects with note count tracking and filtering.
- **Complete Notes Management (CRUD):** Fast creation, rich viewing, editing, and deleting of notes with tags and topics.
- **Instant Search & Multi-Criteria Filtering:** Live search across titles, topics, content, and tags with subject pill filters.
- **Cloud-Ready Document Uploads:** Drag-and-drop file upload interface (PDF, DOCX, TXT up to 10 MB) supporting direct streaming to **Amazon S3** with local fallback.
- **Multimodal AI Integration:** Powered by the official **Google GenAI Node.js SDK (`@google/genai`)** with Google Gemini 2.5.
- **Containerization & Cloud Deployment Readiness:** Fully packaged with a production-ready **Dockerfile** and architecture designed for **AWS EC2**.

---

## 3. Technology Stack

| Layer | Technologies | Purpose |
|:---|:---|:---|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | Fast, accessible, framework-free client interface |
| **Styling & Icons** | Bootstrap 5.3 CDN, Font Awesome 6.5, Google Fonts | Responsive academic technology aesthetic with dark mode |
| **Backend** | Node.js (v20+), Express.js 5 | Lightweight, asynchronous REST API and static server |
| **Database** | SQLite via `better-sqlite3` | High-performance, zero-config relational database |
| **Authentication** | `express-session`, `bcryptjs` | Session-based state with salted password hashing |
| **AI Integration** | `@google/genai` (Official Google GenAI SDK) | Automated note summarization and 5-MCQ quiz generation |
| **Cloud Storage** | `@aws-sdk/client-s3` (Amazon S3) | Scalable cloud document storage with local fallback |
| **Containerization** | Docker, Alpine Linux | Reproducible, isolated deployment container |
| **Cloud Target** | AWS EC2 (Elastic Compute Cloud) | Linux virtual server hosting the containerized web app |

---

## 4. Full-Stack System Architecture

```
+-------------------------------------------------------------------------+
|                          CLIENT BROWSER                                 |
|   HTML5 / CSS3 / Vanilla JS (Bootstrap 5.3 + Font Awesome Icons)        |
+------------------------------------+------------------------------------+
                                     |
                           HTTP Requests (JSON / Form Data)
                                     |
                                     v
+-------------------------------------------------------------------------+
|                       NODE.JS + EXPRESS BACKEND                         |
|   server.js (Listening on 0.0.0.0:3000)                                |
|   ├── Static File Middleware (serves /public)                           |
|   ├── Session Middleware (express-session + cookies)                    |
|   └── REST API Routes:                                                  |
|       ├── /api/auth   -> bcrypt authentication & student sessions       |
|       ├── /api/notes  -> CRUD, search, filter, and dashboard metrics    |
|       ├── /api/files  -> Multer upload, download streaming, & S3 driver |
|       └── /api/ai     -> Gemini summarization & quiz generator          |
+-----------+------------------------+-----------------------+------------+
            |                        |                       |
            v                        v                       v
+-----------------------+  +-------------------+  +-----------------------+
|    SQLITE DATABASE    |  |     AMAZON S3     |  |   GOOGLE GEMINI API   |
|  database/            |  |  AWS Cloud Bucket |  |   @google/genai SDK   |
|  smartnotes.db        |  |  Object Storage   |  |   gemini-2.5-flash    |
|  (USERS, NOTES,       |  |  (PDF, DOCX, TXT) |  |   Summary & MCQs      |
|   FILES, QUIZ_RESULTS)|  |                   |  |                       |
+-----------------------+  +-------------------+  +-----------------------+
```

---

## 5. Folder Structure

```
SmartNotes/
│
├── server.js                  # Express backend entry point (serves public/ & APIs)
├── package.json               # Node.js project manifest & dependencies
├── package-lock.json          # Exact dependency lockfile
├── .env                       # Local environment variables (PORT, S3, Gemini)
├── .env.example               # Template environment configuration
├── .gitignore                 # Excludes node_modules, database files, and secrets
├── Dockerfile                 # Production Docker image configuration
├── .dockerignore              # Excludes unnecessary files from container builds
├── README.md                  # Comprehensive project documentation
│
├── database/
│   ├── db.js                  # SQLite initialization, tables & demo seeding
│   └── smartnotes.db          # Auto-created SQLite database file
│
├── routes/
│   ├── auth.js                # Register, login, logout, profile & password APIs
│   ├── notes.js               # Notes CRUD, search, subject filters & stats API
│   ├── files.js               # Multer file upload, S3 stream & delete APIs
│   └── ai.js                  # Google Gemini summary, quiz & scoring APIs
│
├── services/
│   ├── s3.js                  # AWS S3 Client with graceful local storage fallback
│   └── gemini.js              # Google GenAI SDK integration for summaries & MCQs
│
├── public/                    # Frontend client assets
│   ├── index.html             # Landing homepage with hero, features & cloud preview
│   ├── login.html             # Student login with demo auto-fill
│   ├── register.html          # Student registration page
│   ├── dashboard.html         # Main dashboard with live statistics & recent notes
│   ├── notes.html             # Notes repository with search, filter pills, grid/list
│   ├── create-note.html       # Note creation form with subject & tag selection
│   ├── edit-note.html         # Note edit form prefilled from database
│   ├── view-note.html         # Formatted academic note reader with AI ribbon
│   ├── upload.html            # Document upload zone with animated progress bar
│   ├── summary.html           # AI Note Summary with 5 structured sections
│   ├── quiz.html              # 5-question interactive MCQ revision quiz
│   ├── quiz-result.html       # Scorecard, accuracy gauge, & question review
│   ├── subjects.html          # Curriculum subject directory (6 subjects)
│   ├── profile.html           # Student profile & academic department details
│   ├── settings.html          # Appearance (Dark/Light mode), alerts & reset
│   │
│   ├── css/
│   │   ├── style.css          # Core design system tokens, sidebar, headers & toasts
│   │   ├── dashboard.css      # Welcome banner, stat cards & AI action cards
│   │   ├── forms.css          # Auth card, form controls, and note editor
│   │   ├── notes.css          # Note cards, filter pills, list/grid layouts
│   │   ├── summary.css        # AI processing pulse, definition cards & tags
│   │   └── quiz.css           # Quiz cards, options, score gauge & review
│   │
│   ├── js/
│   │   ├── main.js            # Auth verification, logout, theme & delete modal
│   │   ├── auth.js            # Frontend login & register form handlers
│   │   ├── dashboard.js       # Live dashboard stats & recent notes fetcher
│   │   ├── notes.js           # Live search, subject filter, and CRUD client logic
│   │   ├── upload.js          # File upload, S3 indicator, & file table client
│   │   ├── summary.js         # AI summary generator client & markdown export
│   │   ├── quiz.js            # AI quiz client, navigation, and score recording
│   │   └── profile.js         # Profile client & password update handlers
│   │
│   └── assets/
│       └── icons/
│           └── favicon.svg    # SmartNotes SVG vector favicon
│
└── tests/
    └── test_api.js            # Automated backend unit & integration test suite
```

---

## 6. How to Install and Run Locally

### Prerequisites
- [Node.js](https://nodejs.org/) version 18 or higher (Node 20+ recommended).
- Git (optional).

### Step 1: Install Dependencies
Open your terminal (PowerShell, Command Prompt, or bash) in the project directory:
```bash
npm install
```
*(On Windows PowerShell if script execution is restricted, run: `cmd.exe /c npm install`)*

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(On Windows: `copy .env.example .env`)*

By default, `.env` contains:
```env
PORT=3000
SESSION_SECRET=smartnotes_secure_session_secret_key_2026
GEMINI_API_KEY=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
```
> [!NOTE]
> Even if you leave `GEMINI_API_KEY` and AWS credentials blank, **the application will run locally without crashing**. The database, authentication, notes CRUD, and document storage automatically use safe local fallbacks!

### Step 3: Run the Automated Test Suite
Verify that the database, authentication, notes CRUD, and services pass all tests:
```bash
npm test
```
Expected output:
```
====================================================
  TEST RESULTS: 12 PASSED, 0 FAILED
====================================================
```

### Step 4: Start the Web Server
```bash
npm start
```
Or for development with automatic restart:
```bash
npm run dev
```

### Step 5: Open in Your Browser
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 7. Demo Login Credentials

SmartNotes comes pre-seeded with a default student account and 6 academic curriculum notes for immediate college project demonstration:

- **Email:** `student@smartnotes.demo`
- **Password:** `student123`

On the login page, you can simply click **"Click to auto-fill credentials"** to sign in instantly.

---

## 8. Google Gemini API Setup (Optional)

To enable live Google Gemini AI note summaries and dynamic quiz generation:

1. Visit [Google AI Studio](https://aistudio.google.com/) and sign in with your Google account.
2. Click **"Get API key"** and create a free API key.
3. Open your `.env` file in the project folder and paste the key:
   ```env
   GEMINI_API_KEY=AIzaSyYourActualGeminiKeyHere
   ```
4. Restart the server (`npm start`).
5. Open `summary.html` or `quiz.html` &rarr; the application will now query Gemini in real-time!

> **If no key is configured:** The backend responds with `"AI features are not configured yet."` and smoothly displays the pre-compiled curriculum summary and quiz so that college evaluations proceed without interruptions.

---

## 9. Amazon S3 Setup (Optional)

To enable cloud document storage with Amazon Web Services:

1. Log in to the [AWS Management Console](https://aws.amazon.com/console/).
2. Navigate to **Amazon S3** &rarr; click **"Create bucket"**.
   - Bucket name: e.g., `smartnotes-study-materials-2026`
   - Region: e.g., `us-east-1`
   - Keep "Block all public access" **Checked** (SmartNotes securely streams files through backend IAM credentials; the bucket remains completely private).
3. In AWS IAM, create an Access Key with `AmazonS3FullAccess` or a scoped S3 Put/Get policy.
4. Update your `.env` file:
   ```env
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   S3_BUCKET_NAME=smartnotes-study-materials-2026
   ```
5. Restart the server. Any document uploaded on `upload.html` will now be stored in your private Amazon S3 bucket, and the UI will display the **Amazon S3** badge!

---

## 10. Docker Setup & Containerization

SmartNotes includes a lightweight, production-ready `Dockerfile` based on Node 20 LTS Alpine.

### 1. Build the Docker Image
```bash
docker build -t smartnotes:latest .
```

### 2. Run the Container
```bash
docker run -d -p 3000:3000 --name smartnotes-app smartnotes:latest
```

To run with your `.env` file passed to the container:
```bash
docker run -d -p 3000:3000 --env-file .env --name smartnotes-app smartnotes:latest
```

### 3. Verify Container Status
```bash
docker ps
```
Visit `http://localhost:3000` in your browser.

---

## 11. AWS EC2 Deployment Guide (Step-by-Step)

Here are the exact instructions to deploy SmartNotes on an AWS EC2 instance:

### Step 1: Launch an AWS EC2 Instance
1. Log in to the AWS Console &rarr; Go to **EC2** &rarr; Click **"Launch Instance"**.
2. **Name:** `SmartNotes-Server`
3. **AMI:** Amazon Linux 2023 AMI (or Ubuntu 24.04 LTS).
4. **Instance Type:** `t2.micro` or `t3.micro` (AWS Free Tier eligible).
5. **Key Pair:** Select or create a `.pem` key pair (e.g., `smartnotes-key.pem`).
6. **Network Settings (Security Group):**
   - Allow **SSH** (Port 22) from your IP.
   - Allow **Custom TCP** (Port 3000) from Anywhere (`0.0.0.0/0`) OR Allow **HTTP** (Port 80) if using Nginx reverse proxy.
7. Click **"Launch Instance"**.

### Step 2: Connect to Your EC2 Instance
```bash
chmod 400 smartnotes-key.pem
ssh -i smartnotes-key.pem ec2-user@<YOUR-EC2-PUBLIC-IP>
```

### Step 3: Install Docker on EC2
On Amazon Linux 2023:
```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
```
*(Log out and log back in so the docker group permissions take effect).*

### Step 4: Clone or Copy SmartNotes to EC2
```bash
git clone https://github.com/your-username/smartnotes.git
cd smartnotes
```
*(Or transfer files directly from your computer using SCP):*
```bash
scp -i smartnotes-key.pem -r ./* ec2-user@<YOUR-EC2-PUBLIC-IP>:~/smartnotes/
```

### Step 5: Configure Environment Variables
```bash
nano .env
```
Paste your production settings:
```env
PORT=3000
SESSION_SECRET=strong_production_random_secret_here
GEMINI_API_KEY=your_gemini_key
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
S3_BUCKET_NAME=your_bucket_name
```

### Step 6: Build & Run with Docker
```bash
docker build -t smartnotes .
docker run -d --restart always -p 3000:3000 --env-file .env --name smartnotes smartnotes
```

### Step 7: Access the Application
Open your browser and visit:
```
http://<YOUR-EC2-PUBLIC-IP>:3000
```
SmartNotes is now live in the cloud!

---

## 12. Verification & Testing Checklist

- [x] **Backend Server:** Express app starts on `0.0.0.0:3000` with graceful error handling.
- [x] **Database Initialization:** SQLite automatically creates tables and seeds demo user and notes.
- [x] **Authentication:** Login, register, logout, password hashing with bcrypt, session persistence.
- [x] **Notes CRUD:** Create, read, edit, delete, search, subject filter, and dynamic dashboard metrics.
- [x] **Document Uploads:** Multer validation (10 MB, PDF/DOCX/TXT), download streaming, S3 and local storage support.
- [x] **AI Summaries:** Integration with Google Gemini SDK (`@google/genai`) with fallback handling.
- [x] **AI Quizzes:** 5 MCQs generated via Gemini with real-time scoring and database result saving.
- [x] **Appearance:** Dark Mode and Light Mode persist across all pages.
- [x] **Containerization:** `Dockerfile` and `.dockerignore` ready for Docker and AWS EC2.
- [x] **Zero Frontend Degradation:** All existing visual styles, colors, badges, and animations are 100% preserved.

---

## 13. Academic Attribution

Developed for **College Cloud Computing Mini Project** evaluation.  
Department of Computer Engineering.

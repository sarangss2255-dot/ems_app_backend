const express = require("express");

const router = express.Router();

const endpoints = [
  {
    method: "POST",
    path: "/api/auth/register",
    auth: "None",
    description: "Create a user account.",
    body: {
      username: "string",
      password: "string",
      fullName: "string",
      role: "admin | teacher | student",
      rollNumber: "string",
      className: "string"
    }
  },
  {
    method: "POST",
    path: "/api/auth/login",
    auth: "None",
    description: "Authenticate and receive a bearer token.",
    body: {
      username: "string",
      password: "string"
    }
  },
  {
    method: "POST",
    path: "/api/admin/classrooms",
    auth: "Bearer admin",
    description: "Create a classroom.",
    body: {
      name: "string",
      rows: "number",
      benchesPerRow: "number",
      seatsPerBench: "number",
      capacity: "number",
      pattern: "normal | gap | zigzag",
      gap: "number"
    }
  },
  {
    method: "POST",
    path: "/api/admin/classrooms/upload",
    auth: "Bearer admin",
    description: "Upload classrooms as CSV. Expected columns: name, rows, benchesPerRow, seatsPerBench, capacity, pattern, gap."
  },
  {
    method: "GET",
    path: "/api/admin/classrooms",
    auth: "Bearer admin",
    description: "List classrooms."
  },
  {
    method: "GET",
    path: "/api/admin/classrooms/:id",
    auth: "Bearer admin",
    description: "Get one classroom."
  },
  {
    method: "PUT",
    path: "/api/admin/classrooms/:id",
    auth: "Bearer admin",
    description: "Update a classroom."
  },
  {
    method: "DELETE",
    path: "/api/admin/classrooms/:id",
    auth: "Bearer admin",
    description: "Delete a classroom."
  },
  {
    method: "GET",
    path: "/api/admin/classrooms/:id/generate",
    auth: "Bearer admin",
    description: "Generate and persist seating with anti-cheat report for a classroom."
  },
  {
    method: "POST",
    path: "/api/admin/classrooms/:id/reshuffle",
    auth: "Bearer admin",
    description: "Reshuffle and persist an already generated seating plan."
  },
  {
    method: "POST",
    path: "/api/admin/classrooms/:id/move-seat",
    auth: "Bearer admin",
    description: "Move a student to a specific row/bench/seat inside the persisted seating plan.",
    body: {
      studentId: "mongoId",
      row: "number",
      bench: "number",
      seat: "number"
    }
  },
  {
    method: "GET",
    path: "/api/admin/classrooms/:id/export",
    auth: "Bearer admin",
    description: "Download the persisted seating plan as CSV for spreadsheet use."
  },
  {
    method: "GET",
    path: "/api/admin/students",
    auth: "Bearer admin",
    description: "List all students for admin view."
  },
  {
    method: "POST",
    path: "/api/admin/students/preview",
    auth: "Bearer admin",
    description: "Preview mapped student rows from CSV/XLSX before importing."
  },
  {
    method: "POST",
    path: "/api/admin/students/upload",
    auth: "Bearer admin",
    description: "Upload students as CSV or XLSX. EXAM.xlsx format is supported with columns like Sr. No, Year, Program, Specialization, Student Name, URN."
  },
  {
    method: "DELETE",
    path: "/api/admin/students/:identifier",
    auth: "Bearer admin",
    description: "Delete a student by username or Mongo id."
  },
  {
    method: "POST",
    path: "/api/admin/teachers/upload",
    auth: "Bearer admin",
    description: "Upload teachers as CSV or XLSX and auto-assign them to open classrooms when possible. Expected columns: username, password, fullName, assignedClassroom, autoAssign."
  },
  {
    method: "GET",
    path: "/api/admin/students/export-credentials",
    auth: "Bearer admin",
    description: "Download student usernames and initial passwords as CSV."
  },
  {
    method: "POST",
    path: "/api/admin/students/bulk",
    auth: "Bearer admin",
    description: "Bulk-create students.",
    body: {
      students: [
        {
          username: "string",
          password: "string",
          fullName: "string",
          rollNumber: "string",
          className: "string"
        }
      ]
    }
  },
  {
    method: "POST",
    path: "/api/admin/assign-teacher",
    auth: "Bearer admin",
    description: "Assign a teacher to a classroom, or auto-assign if teacherId is omitted and autoAssign is true.",
    body: {
      teacherId: "mongoId",
      classroomId: "mongoId",
      autoAssign: "boolean"
    }
  },
  {
    method: "GET",
    path: "/api/teacher/myhall",
    auth: "Bearer teacher",
    description: "Get the teacher's assigned hall with seating."
  },
  {
    method: "POST",
    path: "/api/teacher/attendance",
    auth: "Bearer teacher",
    description: "Record student attendance.",
    body: {
      studentId: "mongoId",
      status: "present | absent"
    }
  },
  {
    method: "POST",
    path: "/api/teacher/incidents",
    auth: "Bearer teacher",
    description: "Report a cheating incident and optionally relocate the student to a new seat.",
    body: {
      studentId: "mongoId",
      severity: "number",
      notes: "string",
      row: "number",
      bench: "number",
      seat: "number"
    }
  },
  {
    method: "GET",
    path: "/api/student/myseat",
    auth: "Bearer student",
    description: "Get the authenticated student's seat allocation."
  }
];

router.get("/", (req, res) => {
  res.type("html").send(renderHtml(endpoints));
});

router.get("/json", (req, res) => {
  res.json({
    name: "Exam Management API",
    authHeader: "Authorization: Bearer <accessToken>",
    endpoints
  });
});

function renderHtml(items) {
  const cards = items
    .map((item) => {
      const body = item.body
        ? `<pre>${escapeHtml(JSON.stringify(item.body, null, 2))}</pre>`
        : "";

      return `
        <section class="card">
          <div class="row">
            <span class="method ${item.method.toLowerCase()}">${item.method}</span>
            <code>${escapeHtml(item.path)}</code>
          </div>
          <p>${escapeHtml(item.description)}</p>
          <p><strong>Auth:</strong> ${escapeHtml(item.auth)}</p>
          ${body}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Exam Management API Docs</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: #fffaf2;
        --ink: #1f2933;
        --muted: #52606d;
        --border: #d9cbb5;
        --accent: #8d4f18;
        --post: #166534;
        --get: #1d4ed8;
        --put: #b45309;
        --delete: #b91c1c;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top right, rgba(141, 79, 24, 0.12), transparent 28%),
          linear-gradient(180deg, #f7f2ea, var(--bg));
        color: var(--ink);
      }
      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 40px 20px 64px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 2.4rem;
      }
      p {
        color: var(--muted);
        line-height: 1.5;
      }
      .lead {
        max-width: 720px;
        margin-bottom: 24px;
      }
      .note {
        background: rgba(255, 250, 242, 0.88);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px 16px;
        margin-bottom: 24px;
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 10px 30px rgba(31, 41, 51, 0.06);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 10px;
      }
      .method {
        display: inline-block;
        min-width: 72px;
        text-align: center;
        border-radius: 999px;
        padding: 4px 10px;
        color: white;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .method.get { background: var(--get); }
      .method.post { background: var(--post); }
      .method.put { background: var(--put); }
      .method.delete { background: var(--delete); }
      code, pre {
        font-family: Consolas, "Courier New", monospace;
      }
      code {
        font-size: 0.95rem;
        word-break: break-word;
      }
      pre {
        margin: 12px 0 0;
        overflow-x: auto;
        background: #f8f1e4;
        border-radius: 12px;
        padding: 14px;
        border: 1px solid #ead9be;
        color: #3f2d1f;
      }
      a {
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Exam Management API</h1>
      <p class="lead">Built-in reference for the current Express backend. Use <code>Authorization: Bearer &lt;accessToken&gt;</code> for protected routes.</p>
      <div class="note">
        <strong>Machine-readable docs:</strong>
        <a href="/docs/json">/docs/json</a>
      </div>
      <div class="grid">${cards}</div>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

module.exports = router;

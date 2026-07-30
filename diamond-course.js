/* Diamond Method course - shared client-side logic.
   Handles session storage, password hashing, and access-gating against
   the JSONBin-backed student roster. Included by every course page. */

var DM_BIN_ID = '6a6a9028da38895dfea1d901';
var DM_MASTER_KEY = '$2a$10$AE8jTzF3OJJNfqTgYPcPK.SzVAdv0Mqi/obwqWTuQjpE0dOkYkCE.';
var DM_TOTAL_LESSONS = 13;

async function dmSha256Hex(str) {
  var enc = new TextEncoder().encode(str);
  var buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function dmGetSession() {
  try { return JSON.parse(localStorage.getItem('dm_session') || 'null'); }
  catch (e) { return null; }
}

function dmSaveSession(email, password) {
  localStorage.setItem('dm_session', JSON.stringify({ email: email.trim().toLowerCase(), password: password }));
}

function dmClearSession() {
  localStorage.removeItem('dm_session');
}

async function dmFetchStudents() {
  var res = await fetch('https://api.jsonbin.io/v3/b/' + DM_BIN_ID + '/latest', {
    headers: { 'X-Master-Key': DM_MASTER_KEY }
  });
  var json = await res.json();
  return (json.record && json.record.students) || [];
}

async function dmSaveStudents(students) {
  await fetch('https://api.jsonbin.io/v3/b/' + DM_BIN_ID, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': DM_MASTER_KEY },
    body: JSON.stringify({ students: students })
  });
}

/* Verifies the locally-stored session against the roster.
   Returns { student, students } on success, or null (and redirects to login) on failure. */
async function dmAuthenticate() {
  var session = dmGetSession();
  if (!session || !session.email || !session.password) {
    location.href = 'diamond-login.html';
    return null;
  }
  var students = await dmFetchStudents();
  var student = students.find(function (s) { return s.email === session.email; });
  if (!student) {
    dmClearSession();
    location.href = 'diamond-login.html';
    return null;
  }
  var hash = await dmSha256Hex(student.salt + session.password);
  if (hash !== student.passwordHash) {
    dmClearSession();
    location.href = 'diamond-login.html';
    return null;
  }
  return { student: student, students: students };
}

/* Call at the top of every lesson page. Redirects to login (no session),
   or back to the furthest unlocked lesson (trying to skip ahead). */
async function dmGuardLesson(lessonIndex) {
  var auth = await dmAuthenticate();
  if (!auth) return null;
  var unlocked = auth.student.unlockedUpTo || 1;
  if (lessonIndex > unlocked) {
    location.href = 'diamond-lesson-' + String(unlocked).padStart(2, '0') + '.html';
    return null;
  }
  return auth;
}

/* Call when the learner clicks "Next" from the furthest lesson they've reached. */
async function dmAdvanceIfNeeded(lessonIndex, students, student) {
  var unlocked = student.unlockedUpTo || 1;
  if (lessonIndex === unlocked && lessonIndex < DM_TOTAL_LESSONS) {
    student.unlockedUpTo = lessonIndex + 1;
    await dmSaveStudents(students);
  }
}

var DM_LESSONS = [
  { index: 1, slug: 'diamond-lesson-01.html', title: 'Introduction' },
  { index: 2, slug: 'diamond-lesson-02.html', title: 'Basics of the Diamond' },
  { index: 3, slug: 'diamond-lesson-03.html', title: 'Soft Palate' },
  { index: 4, slug: 'diamond-lesson-04.html', title: 'Vocal Folds' },
  { index: 5, slug: 'diamond-lesson-05.html', title: 'Putting It All Together' },
  { index: 6, slug: 'diamond-lesson-06.html', title: 'Breathing' },
  { index: 7, slug: 'diamond-lesson-07.html', title: 'Waking Up the Voice' },
  { index: 8, slug: 'diamond-lesson-08.html', title: 'Expanding Your Range' },
  { index: 9, slug: 'diamond-lesson-09.html', title: 'Howling Voice' },
  { index: 10, slug: 'diamond-lesson-10.html', title: 'Shaping Sound' },
  { index: 11, slug: 'diamond-lesson-11.html', title: 'Singing In Pitch' },
  { index: 12, slug: 'diamond-lesson-12.html', title: 'Distortion' },
  { index: 13, slug: 'diamond-lesson-13.html', title: 'You Did It!' }
];

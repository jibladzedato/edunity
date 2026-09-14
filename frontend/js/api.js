// Обёртка над backend API + хранение JWT-токена в localStorage.
// Ключи в localStorage:
//   edunity_token — JWT
//   edunity_user  — закешированные данные пользователя (name, email, ...)

// Если config.js не подключён (страница обновилась не полностью), без этой
// подстраховки всё падало с невнятным «Cannot read properties of undefined».
if (!window.EDUNITY_CONFIG) {
  console.error(
    '[EDUNITY] config.js не загружен — проверь, что <script src=".../js/config.js"> идёт первым на этой странице'
  );
  const host = window.location.hostname || 'localhost';
  const base = window.location.protocol + '//' + host + ':4000/api';
  window.EDUNITY_CONFIG = { API_BASE_URL: base, SERVER_URL: base.replace(/\/api\/?$/, '') };
}

const TOKEN_KEY = "edunity_token";
const USER_KEY = "edunity_user";

const EdunityAuth = {
  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },
  getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function apiRequest(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = EdunityAuth.getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch(window.EDUNITY_CONFIG.API_BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // пустой ответ
  }

  if (!res.ok) {
    const message = (data && data.error) || "დაფიქსირდა შეცდომა, სცადეთ მოგვიანებით";
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

const EdunityAPI = {
  // --- авторизация ---
  register(name, email, password) {
    return apiRequest("/auth/register", { method: "POST", body: { name, email, password } });
  },
  login(email, password) {
    return apiRequest("/auth/login", { method: "POST", body: { email, password } });
  },
  authProviders() {
    return apiRequest("/auth/providers");
  },
  googleLogin(credential) {
    return apiRequest("/auth/google", { method: "POST", body: { credential } });
  },
  verifyEmail(token) {
    return apiRequest("/auth/verify/" + encodeURIComponent(token), { method: "POST" });
  },
  resendVerification(email) {
    return apiRequest("/auth/verify/resend", { method: "POST", body: { email } });
  },
  forgotPassword(email) {
    return apiRequest("/auth/forgot", { method: "POST", body: { email } });
  },
  resetPassword(token, password) {
    return apiRequest("/auth/reset/" + encodeURIComponent(token), { method: "POST", body: { password } });
  },

  // --- профиль ---
  me() {
    return apiRequest("/users/me", { auth: true });
  },
  updateMe(fields) {
    return apiRequest("/users/me", { method: "PATCH", body: fields, auth: true });
  },
  changePassword(currentPassword, newPassword) {
    return apiRequest("/users/me/password", { method: "POST", body: { currentPassword, newPassword }, auth: true });
  },
  deletionPreview() {
    return apiRequest("/users/me/deletion-preview", { auth: true });
  },
  deleteMyAccount(password) {
    return apiRequest("/users/me", { method: "DELETE", body: { password }, auth: true });
  },
  adminUserDeletionPreview(id) {
    return apiRequest("/admin/users/" + id + "/deletion-preview", { auth: true });
  },
  adminDeleteUser(id) {
    return apiRequest("/admin/users/" + id, { method: "DELETE", auth: true });
  },
  myEnrollments() {
    return apiRequest("/users/me/enrollments", { auth: true });
  },

  // --- каталог ---
  courses(params = {}) {
    const q = new URLSearchParams(params).toString();
    return apiRequest("/courses" + (q ? "?" + q : ""), { auth: true });
  },
  course(id) {
    return apiRequest("/courses/" + id, { auth: true });
  },
  myCourses() {
    return apiRequest("/courses/my", { auth: true });
  },
  categories() {
    return apiRequest("/courses/meta/categories");
  },
  homeFeatured() {
    return apiRequest("/courses/home/featured");
  },
  instructorProfile(userId) {
    return apiRequest("/users/" + userId + "/profile");
  },

  // --- админка ---
  adminMe() {
    return apiRequest("/admin/me", { auth: true });
  },
  adminSetRole(id, role) {
    return apiRequest("/admin/users/" + id + "/role", { method: "PATCH", body: { role }, auth: true });
  },
  storageUsage() {
    return apiRequest("/uploads/storage", { auth: true });
  },
  adminMailTest(to) {
    return apiRequest("/admin/mail-test", { method: "POST", body: { to }, auth: true });
  },
  adminStats() {
    return apiRequest("/admin/stats", { auth: true });
  },
  adminCourses() {
    return apiRequest("/admin/courses", { auth: true });
  },
  adminUsers() {
    return apiRequest("/admin/users", { auth: true });
  },
  adminFeatured() {
    return apiRequest("/admin/featured", { auth: true });
  },
  adminAddFeatured(payload) {
    return apiRequest("/admin/featured", { method: "POST", body: payload, auth: true });
  },
  adminRemoveFeatured(id) {
    return apiRequest("/admin/featured/" + id, { method: "DELETE", auth: true });
  },
  adminCategories() {
    return apiRequest("/admin/categories", { auth: true });
  },
  adminAddCategory(name, color) {
    return apiRequest("/admin/categories", { method: "POST", body: { name, color }, auth: true });
  },
  adminUpdateCategory(id, fields) {
    return apiRequest("/admin/categories/" + id, { method: "PATCH", body: fields, auth: true });
  },
  adminDeleteCategory(id) {
    return apiRequest("/admin/categories/" + id, { method: "DELETE", auth: true });
  },
  adminBlockCourse(id, reason) {
    return apiRequest("/admin/courses/" + id + "/block", { method: "POST", body: { reason }, auth: true });
  },
  adminUnblockCourse(id) {
    return apiRequest("/admin/courses/" + id + "/unblock", { method: "POST", auth: true });
  },

  // --- конструктор курса ---
  createCourse(title) {
    return apiRequest("/courses", { method: "POST", body: { title }, auth: true });
  },
  updateCourse(id, fields) {
    return apiRequest("/courses/" + id, { method: "PATCH", body: fields, auth: true });
  },
  deleteCourse(id, force) {
    return apiRequest("/courses/" + id + (force ? "?force=1" : ""), { method: "DELETE", auth: true });
  },
  courseProgress(id) {
    return apiRequest("/courses/" + id + "/progress", { auth: true });
  },
  courseStructure(id) {
    return apiRequest("/courses/" + id + "/structure", { auth: true });
  },
  courseAnalytics(id) {
    return apiRequest("/courses/" + id + "/analytics", { auth: true });
  },

  // модули / уроки / шаги
  createModule(courseId, title) {
    return apiRequest("/courses/" + courseId + "/modules", { method: "POST", body: { title }, auth: true });
  },
  updateModule(id, title) {
    return apiRequest("/modules/" + id, { method: "PATCH", body: { title }, auth: true });
  },
  deleteModule(id) {
    return apiRequest("/modules/" + id, { method: "DELETE", auth: true });
  },
  createLesson(moduleId, title) {
    return apiRequest("/modules/" + moduleId + "/lessons", { method: "POST", body: { title }, auth: true });
  },
  updateLesson(id, title) {
    return apiRequest("/lessons/" + id, { method: "PATCH", body: { title }, auth: true });
  },
  deleteLesson(id) {
    return apiRequest("/lessons/" + id, { method: "DELETE", auth: true });
  },
  lessonSteps(lessonId) {
    return apiRequest("/lessons/" + lessonId + "/steps", { auth: true });
  },
  createStep(lessonId, type) {
    return apiRequest("/lessons/" + lessonId + "/steps", { method: "POST", body: { type }, auth: true });
  },
  step(id) {
    return apiRequest("/steps/" + id, { auth: true });
  },
  updateStep(id, content) {
    return apiRequest("/steps/" + id, { method: "PATCH", body: { content }, auth: true });
  },
  deleteStep(id) {
    return apiRequest("/steps/" + id, { method: "DELETE", auth: true });
  },

  // --- сертификаты ---
  issueCertificate(courseId) {
    return apiRequest("/certificates/issue/" + courseId, { method: "POST", auth: true });
  },
  myCertificates() {
    return apiRequest("/certificates/my", { auth: true });
  },
  verifyCertificate(code) {
    return apiRequest("/certificates/verify/" + encodeURIComponent(code));
  },

  // --- обучение ---
  enroll(courseId) {
    return apiRequest("/courses/" + courseId + "/enroll", { method: "POST", auth: true });
  },
  unenroll(courseId) {
    return apiRequest("/courses/" + courseId + "/enroll", { method: "DELETE", auth: true });
  },
  moveModule(id, direction) {
    return apiRequest("/modules/" + id + "/move", { method: "POST", body: { direction }, auth: true });
  },
  moveLesson(id, direction) {
    return apiRequest("/lessons/" + id + "/move", { method: "POST", body: { direction }, auth: true });
  },
  moveStep(id, direction) {
    return apiRequest("/steps/" + id + "/move", { method: "POST", body: { direction }, auth: true });
  },
  completeStep(stepId, isCorrect) {
    return apiRequest("/steps/" + stepId + "/complete", { method: "POST", body: { isCorrect }, auth: true });
  },
  stepComments(stepId) {
    return apiRequest("/steps/" + stepId + "/comments");
  },
  addComment(stepId, body, parentId) {
    return apiRequest("/steps/" + stepId + "/comments", { method: "POST", body: { body, parentId }, auth: true });
  },
  deleteComment(id) {
    return apiRequest("/comments/" + id, { method: "DELETE", auth: true });
  },
  courseReviews(courseId) {
    return apiRequest("/courses/" + courseId + "/reviews");
  },
  addReview(courseId, rating, body) {
    return apiRequest("/courses/" + courseId + "/reviews", { method: "POST", body: { rating, body }, auth: true });
  },
};

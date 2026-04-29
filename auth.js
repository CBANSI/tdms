const PAGE = document.body.dataset.page || "login";
const DEFAULT_HOSTED_BASE = "http://localhost/tdms/";
const API_URL = window.location.protocol === "file:"
  ? `${DEFAULT_HOSTED_BASE}api/index.php`
  : new URL("api/index.php", window.location.href).toString();

const loginForm = document.getElementById("loginForm");
const loginIdentifier = document.getElementById("loginIdentifier");
const loginIdentifierLabel = document.querySelector(".login-form-cell-identifier .login-field-label");
const loginSecret = document.getElementById("loginSecret");
const loginHelpText = document.getElementById("loginHelpText");
const logoutBtn = document.getElementById("logoutBtn");
const studentLogoutBtn = document.getElementById("studentLogoutBtn");
const studentAccessPanel = document.getElementById("studentAccessPanel");
const registerForm = document.getElementById("registerForm");
const registerStatus = document.getElementById("registerStatus");
const googleLoginMount = document.getElementById("googleLoginMount");
const googleLoginStatus = document.getElementById("googleLoginStatus");
const themeToggleButtons = [...document.querySelectorAll("[data-theme-toggle]")];
const logoFrames = [...document.querySelectorAll("[data-logo-role]")];

const GOOGLE_CLASSROOM_CONFIG = {
  apiKey: "",
  clientId: "",
  discoveryDoc: "https://classroom.googleapis.com/$discovery/rest?version=v1",
  scopes: [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  ].join(" "),
};

let logoutInFlight = false;
let authBindingsInitialized = false;
let themeBindingsInitialized = false;
let publicConfig = {
  googleEnabled: false,
  googleClientId: "",
};
let googleScriptPromise = null;
let classroomTokenClient = null;
let classroomAccessToken = "";
const THEME_STORAGE_KEY = "tdms-theme";
const LOGO_CANDIDATES = {
  tdms: [
    "assets/logos/tdms-logo.png",
    "assets/logos/tdms-logo.png.png",
    "assets/logos/tdms.png",
    "assets/logos/logo-tdms.png",
    "assets/logos/tdms-logo.jpg",
    "assets/logos/tdms-logo.jpeg",
    "assets/logos/tdms-logo.webp",
  ],
  diploma: [
    "assets/logos/diploma-logo.png",
    "assets/logos/diploma-program-logo.png",
    "assets/logos/diploma.png",
    "assets/logos/tvet-logo.png",
    "assets/logos/diploma-logo.jpg",
    "assets/logos/diploma-logo.jpeg",
    "assets/logos/diploma-logo.webp",
  ],
};

function resolveSavedTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "dark" ? "dark" : "light";
  } catch (error) {
    return "light";
  }
}

function updateThemeButtons(theme) {
  themeToggleButtons.forEach((button) => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    button.textContent = nextTheme === "dark" ? "☾" : "☀";
    button.title = `Switch to ${nextTheme} mode`;
    button.setAttribute("aria-label", `Switch to ${nextTheme} mode`);
    button.setAttribute("aria-pressed", String(theme === "dark"));
  });
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;
  updateThemeButtons(nextTheme);

  if (!persist) return;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (error) {
    console.warn("TDMS theme preference could not be saved.", error);
  }
}

function toggleTheme() {
  const currentTheme = document.body.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

function initThemeBindings() {
  if (themeBindingsInitialized) return;
  themeBindingsInitialized = true;
  applyTheme(resolveSavedTheme(), false);
  themeToggleButtons.forEach((button) => button.addEventListener("click", toggleTheme));
}

function preloadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = reject;
    image.src = src;
  });
}

async function resolveLogoSource(role) {
  const candidates = LOGO_CANDIDATES[role] || [];

  for (const candidate of candidates) {
    try {
      await preloadImage(candidate);
      return candidate;
    } catch (error) {
      continue;
    }
  }

  return "";
}

async function initLogoBindings() {
  if (!logoFrames.length) return;

  await Promise.all(logoFrames.map(async (frame) => {
    const role = frame.dataset.logoRole || "";
    const image = frame.querySelector("img");
    if (!image) return;

    const source = await resolveLogoSource(role);
    if (!source) {
      frame.classList.add("is-fallback");
      return;
    }

    image.src = source;
    frame.classList.remove("is-fallback");
    frame.classList.add("has-logo");
  }));
}

function getHostedBaseUrl() {
  if (window.location.protocol !== "file:") {
    return new URL("./", window.location.href).toString();
  }
  return DEFAULT_HOSTED_BASE;
}

function getTdmsHttpUrl(path = "") {
  const baseUrl = getHostedBaseUrl();
  const nextPath = String(path || "").trim().replace(/^\/+/, "");
  const currentFile = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
  const fileName = nextPath || currentFile;
  const target = new URL(fileName, baseUrl);
  target.search = window.location.search;
  target.hash = window.location.hash;
  return target.toString();
}

function redirectToHostedTdms(path = "") {
  const target = getTdmsHttpUrl(path);
  window.location.replace(target);
}

function redirect(path) {
  if (window.location.protocol === "file:") {
    redirectToHostedTdms(path);
    return;
  }
  window.location.href = path;
}

function redirectToRolePage(session) {
  if (session.role === "staff") {
    redirect("admin.html");
    return;
  }

  if (session.role === "student") {
    redirect("student.html");
    return;
  }

  redirect("index.html");
}

async function apiRequest(action, method = "GET", body = null) {
  const options = {
    method,
    credentials: "same-origin",
    headers: {},
  };

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, options);
  } catch (error) {
    if (window.location.protocol === "file:") {
      redirectToHostedTdms();
      return new Promise(() => {});
    }
    throw new Error(`Failed to reach the TDMS API. Open the app from ${getHostedBaseUrl()}.`);
  }
  const responseText = await response.text();
  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new Error("The server returned an invalid response. Please refresh and try again.");
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

async function fetchSession() {
  const response = await apiRequest("session");
  return response.session;
}

async function fetchPublicConfig() {
  try {
    const response = await apiRequest("public-config");
    publicConfig = response.config || publicConfig;
  } catch (error) {
    publicConfig = {
      googleEnabled: false,
      googleClientId: "",
    };
    setStatus(googleLoginStatus, "Google sign-in is unavailable right now.", true);
  }

  return publicConfig;
}

function getGoogleClientId() {
  const configuredClientId = String(GOOGLE_CLASSROOM_CONFIG.clientId || "").trim();
  if (configuredClientId) return configuredClientId;
  return String(publicConfig.googleClientId || "").trim();
}

function getGoogleClassroomConfig() {
  return {
    apiKey: String(GOOGLE_CLASSROOM_CONFIG.apiKey || "").trim(),
    clientId: getGoogleClientId(),
    discoveryDoc: GOOGLE_CLASSROOM_CONFIG.discoveryDoc,
    scopes: GOOGLE_CLASSROOM_CONFIG.scopes,
    configured: Boolean(getGoogleClientId()),
  };
}

function setStatus(node, message, isError = false) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function renderRegisterStatus(response) {
  if (!registerStatus) return;

  registerStatus.classList.remove("is-error");
  registerStatus.innerHTML = "";

  const message = document.createElement("span");
  message.textContent = response.message || "Registration received. Please verify your email before logging in.";
  registerStatus.appendChild(message);

  if (response.emailDeliveryFailed && response.verificationUrl) {
    const helper = document.createElement("span");
    helper.style.display = "block";
    helper.style.marginTop = "8px";
    helper.textContent = "Localhost fallback: open this verification link to activate the student account.";
    registerStatus.appendChild(helper);

    const link = document.createElement("a");
    link.href = response.verificationUrl;
    link.textContent = "Verify account now";
    link.style.display = "inline-block";
    link.style.marginTop = "8px";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    registerStatus.appendChild(link);
  }
}

function loadScript(src) {
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve(existing);
        return;
      }
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google sign-in.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve(script);
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load Google sign-in.")), { once: true });
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

async function ensureGoogleButton() {
  if ((PAGE !== "login" && PAGE !== "register") || !googleLoginMount || !googleLoginStatus) return;

  if (!publicConfig.googleClientId) {
    await fetchPublicConfig();
  }

  if (!getGoogleClientId()) {
    googleLoginMount.innerHTML = "";
    setStatus(googleLoginStatus, "Google sign-in is not configured yet. Add your Google client ID in auth.js or api/config.php.");
    return;
  }

  await loadScript("https://accounts.google.com/gsi/client");

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    googleLoginMount.innerHTML = "";
    setStatus(googleLoginStatus, "Google sign-in failed to load.", true);
    return;
  }

  googleLoginMount.innerHTML = "";
  window.google.accounts.id.initialize({
    client_id: getGoogleClientId(),
    callback: handleGoogleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  window.google.accounts.id.renderButton(googleLoginMount, {
    type: "standard",
    theme: "outline",
    text: "continue_with",
    size: "large",
    shape: "pill",
    width: 360,
  });
  setStatus(googleLoginStatus, "Students can continue with Gmail and connect Google Classroom after login.");
}

async function ensureGoogleOAuthClient() {
  await loadScript("https://accounts.google.com/gsi/client");

  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error("Google OAuth failed to load.");
  }

  if (!getGoogleClientId()) {
    throw new Error("Google Classroom is not configured yet. Add your Google client ID in auth.js or api/config.php.");
  }

  if (!classroomTokenClient) {
    classroomTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: getGoogleClientId(),
      scope: GOOGLE_CLASSROOM_CONFIG.scopes,
      callback: () => {},
    });
  }

  return classroomTokenClient;
}

async function requestGoogleClassroomAccessToken(prompt = "consent") {
  if (classroomAccessToken) return classroomAccessToken;

  const tokenClient = await ensureGoogleOAuthClient();

  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response && response.access_token) {
        classroomAccessToken = response.access_token;
        resolve(classroomAccessToken);
        return;
      }

      reject(new Error(response?.error_description || response?.error || "Google Classroom authorization failed."));
    };

    tokenClient.requestAccessToken({
      prompt,
    });
  });
}

async function googleClassroomRequest(path, params = {}) {
  const token = await requestGoogleClassroomAccessToken();
  const url = new URL(`https://classroom.googleapis.com/v1/${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "Google Classroom request failed.");
  }

  return data;
}

async function fetchGoogleClassroomSnapshot(prompt = "consent") {
  await requestGoogleClassroomAccessToken(prompt);

  const coursesData = await googleClassroomRequest("courses", {
    studentId: "me",
    courseStates: "ACTIVE",
    pageSize: 10,
  });

  const courses = Array.isArray(coursesData.courses) ? coursesData.courses : [];
  const courseWorkResults = await Promise.all(courses.slice(0, 6).map(async (course) => {
    try {
      const data = await googleClassroomRequest(`courses/${encodeURIComponent(course.id)}/courseWork`, {
        pageSize: 5,
      });
      return Array.isArray(data.courseWork)
        ? data.courseWork.map((item) => ({ ...item, courseName: course.name || "Untitled class" }))
        : [];
    } catch (error) {
      return [];
    }
  }));

  return {
    courses,
    courseWork: courseWorkResults.flat(),
  };
}

async function logout() {
  if (logoutInFlight) return;
  logoutInFlight = true;

  if (logoutBtn) logoutBtn.disabled = true;
  if (studentLogoutBtn) studentLogoutBtn.disabled = true;

  try {
    await apiRequest("logout", "POST", {});
  } catch (error) {
    try {
      await fetch(`${API_URL}?action=logout`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (fallbackError) {
      alert(error.message || fallbackError.message || "Logout failed.");
    }
  } finally {
    window.location.replace("index.html");
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  try {
    const formData = new FormData(loginForm);
    const response = await apiRequest("login", "POST", {
      identifier: formData.get("loginIdentifier").toString().trim(),
      secret: formData.get("loginSecret").toString().trim(),
    });

    redirectToRolePage(response.session);
  } catch (error) {
    alert(error.message || "Login failed.");
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  try {
    const formData = new FormData(registerForm);
    const studentId = formData.get("registerStudentId").toString().trim();
    if (!/^\d{4}-\d{3}-\d{5}$/.test(studentId)) {
      throw new Error("Student ID must use the format 0000-000-00000.");
    }

    const response = await apiRequest("register-student", "POST", {
      studentId,
      fullName: formData.get("registerFullName").toString().trim(),
      program: formData.get("registerProgram").toString().trim(),
      email: formData.get("registerEmail").toString().trim(),
      password: formData.get("registerPassword").toString(),
      passwordConfirm: formData.get("registerPasswordConfirm").toString(),
      contact: formData.get("registerContact").toString().trim(),
    });

    renderRegisterStatus(response);
    registerForm.reset();
    window.alert(
      response.emailDeliveryFailed && response.verificationUrl
        ? "Account created. Email sending is not configured on this local machine yet. Use the verification link shown on the page to activate the account."
        : "Registration received. Please check your email and click the verification link before logging in."
    );

  } catch (error) {
    setStatus(registerStatus, error.message || "Registration failed.", true);
    window.alert(error.message || "Registration failed.");
  }
}

async function handleGoogleCredentialResponse(googleResponse) {
  if (!googleResponse || !googleResponse.credential) {
    setStatus(googleLoginStatus, "Google sign-in did not return a valid credential.", true);
    return;
  }

  try {
    setStatus(googleLoginStatus, "Signing you in with Gmail...");
    const response = await apiRequest("login-google", "POST", {
      idToken: googleResponse.credential,
    });
    redirectToRolePage(response.session);
  } catch (error) {
    setStatus(googleLoginStatus, error.message || "Google sign-in failed.", true);
  }
}

function updateLoginHelpText() {
  if (PAGE === "register") {
    return;
  }

  if (!loginIdentifier || !loginSecret) return;
  loginIdentifier.placeholder = "Enter username";
  loginSecret.placeholder = "Enter password";
  loginSecret.type = "password";
  if (studentAccessPanel) studentAccessPanel.hidden = false;
}

function showEmailVerificationStatus() {
  if (PAGE !== "login") return;

  const params = new URLSearchParams(window.location.search);
  const verificationStatus = params.get("emailVerification");
  if (!verificationStatus) return;

  if (verificationStatus === "success") {
    if (loginHelpText) loginHelpText.textContent = "Email verified. You can now log in as a student.";
    window.alert("Email verified. You can now log in.");
  } else {
    if (loginHelpText) loginHelpText.textContent = "Email verification failed or expired. Please register again or ask staff for help.";
    window.alert("Email verification failed or expired.");
  }

  params.delete("emailVerification");
  const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function initAuthBindings() {
  if (authBindingsInitialized) return;
  authBindingsInitialized = true;
  if (window.location.protocol === "file:") {
    redirectToHostedTdms();
    return;
  }
  initThemeBindings();
  initLogoBindings();

  if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (studentLogoutBtn) studentLogoutBtn.addEventListener("click", logout);
  if (registerForm) registerForm.addEventListener("submit", handleRegisterSubmit);

  if (PAGE === "login" || PAGE === "register") {
    fetchPublicConfig().finally(() => {
      updateLoginHelpText();
      showEmailVerificationStatus();
    });
  }
}

window.tdmsAuth = {
  PAGE,
  apiRequest,
  fetchSession,
  redirect,
  redirectToRolePage,
  updateLoginHelpText,
  initAuthBindings,
  applyTheme,
  toggleTheme,
  getGoogleClassroomConfig,
  fetchGoogleClassroomSnapshot,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthBindings, { once: true });
} else {
  initAuthBindings();
}

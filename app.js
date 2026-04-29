(async () => {
  async function getTdmsAuth(attempt = 0) {
    if (window.tdmsAuth) return window.tdmsAuth;
    if (attempt >= 40) {
      throw new Error("TDMS auth script did not load. Refresh the page and try again.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    return getTdmsAuth(attempt + 1);
  }

  const {
    PAGE,
    apiRequest,
    fetchSession,
    redirect,
    redirectToRolePage,
    updateLoginHelpText,
    initAuthBindings,
    getGoogleClassroomConfig,
    fetchGoogleClassroomSnapshot,
  } = await getTdmsAuth();

const state = {
  session: {
    isLoggedIn: false,
    role: "",
    userName: "",
    studentId: "",
    adminId: "",
    staffEmail: "",
    mustChangePassword: false,
  },
  adminAccount: null,
  students: [],
  subjects: [],
  tasks: [],
  announcements: [],
  student: null,
  currentStudentTab: "tasks",
  currentAdminTab: "requirements",
  classroom: {
    loading: false,
    loaded: false,
    courses: [],
    courseWork: [],
    error: "",
  },
  studentTaskComposerOpen: false,
};

const STUDENT_TABS = new Set(["tasks", "subjects", "notifications", "calendar", "classroom"]);
const ADMIN_TABS = new Set(["requirements", "announcements"]);
const STUDENT_REMINDER_DAYS = new Set([3, 2, 0]);

const emptyStateTemplate = document.getElementById("emptyStateTemplate");

const seedDemoBtn = document.getElementById("seedDemoBtn");
const clearDataBtn = document.getElementById("clearDataBtn");
const printReportBtn = document.getElementById("printReportBtn");
const taskSearch = document.getElementById("taskSearch");
const reminderList = document.getElementById("reminderList");
const adminOverdueList = document.getElementById("adminOverdueList");
const focusList = document.getElementById("focusList");
const currentUserRole = document.getElementById("currentUserRole");
const currentUserName = document.getElementById("currentUserName");
const adminHeaderRole = document.getElementById("adminHeaderRole");
const adminHeaderName = document.getElementById("adminHeaderName");
const adminSectionMenu = document.getElementById("adminSectionMenu");
const adminTabButtons = [...document.querySelectorAll("[data-admin-tab]")];
const adminTabPanels = [...document.querySelectorAll("[data-admin-tab-panel]")];
const adminReminderForm = document.getElementById("adminReminderForm");
const adminReminderTargetMode = document.getElementById("adminReminderTargetMode");
const adminReminderYearWrap = document.getElementById("adminReminderYearWrap");
const adminReminderYearLevel = document.getElementById("adminReminderYearLevel");
const adminReminderStudent = document.getElementById("adminReminderStudent");
const adminAnnouncementForm = document.getElementById("adminAnnouncementForm");
const adminAnnouncementList = document.getElementById("adminAnnouncementList");
const adminSecurityForm = document.getElementById("adminSecurityForm");
const adminSecurityNotice = document.getElementById("adminSecurityNotice");
const adminSecurityUsername = document.getElementById("adminSecurityUsername");
const adminSecurityFullName = document.getElementById("adminSecurityFullName");
const adminSecurityEmail = document.getElementById("adminSecurityEmail");
const adminSecurityCurrentPassword = document.getElementById("adminSecurityCurrentPassword");
const adminSecurityNewPassword = document.getElementById("adminSecurityNewPassword");
const adminSecurityConfirmPassword = document.getElementById("adminSecurityConfirmPassword");
const adminSecuritySubmit = document.getElementById("adminSecuritySubmit");
const adminSecurityStatus = document.getElementById("adminSecurityStatus");

const studentSectionMenu = document.getElementById("studentSectionMenu");
const studentSubjectForm = document.getElementById("studentSubjectForm");
const studentSubjectList = document.getElementById("studentSubjectList");
const studentSubjectStatus = document.getElementById("studentSubjectStatus");
const studentSubjectSubmit = document.getElementById("studentSubjectSubmit");
const studentTaskForm = document.getElementById("studentTaskForm");
const studentTaskComposer = document.getElementById("studentTaskComposer");
const studentTaskComposerBar = document.getElementById("studentTaskComposerBar");
const studentTaskComposerToggle = document.getElementById("studentTaskComposerToggle");
const studentTaskComposerCancel = document.getElementById("studentTaskComposerCancel");
const studentTaskSubject = document.getElementById("studentTaskSubject");
const studentProfileCard = document.getElementById("studentProfileCard");
const studentReminderList = document.getElementById("studentReminderList");
const studentTaskTableBody = document.getElementById("studentTaskTableBody");
const studentPendingCount = document.getElementById("studentPendingCount");
const studentCompletedCount = document.getElementById("studentCompletedCount");
const studentDueSoonCount = document.getElementById("studentDueSoonCount");
const studentOverdueCount = document.getElementById("studentOverdueCount");
const studentHeaderId = document.getElementById("studentHeaderId");
const studentHeaderName = document.getElementById("studentHeaderName");
const studentTabButtons = [...document.querySelectorAll("[data-student-tab]")];
const studentTabPanels = [...document.querySelectorAll("[data-student-tab-panel]")];
const studentDocumentList = document.getElementById("studentDocumentList");
const studentNotificationList = document.getElementById("studentNotificationList");
const studentCalendarMonthLabel = document.getElementById("studentCalendarMonthLabel");
const studentCalendarGrid = document.getElementById("studentCalendarGrid");
const studentCalendarAgenda = document.getElementById("studentCalendarAgenda");
const studentClassroomList = document.getElementById("studentClassroomList");
const studentPrintTasksBtn = document.getElementById("studentPrintTasksBtn");

bindEvents();
bootstrap().catch(showError);

function bindEvents() {
  initAuthBindings();
  if (seedDemoBtn) seedDemoBtn.addEventListener("click", seedDemoData);
  if (clearDataBtn) clearDataBtn.addEventListener("click", clearAllData);
  if (printReportBtn) printReportBtn.addEventListener("click", () => window.print());
  if (taskSearch) {
    taskSearch.addEventListener("input", () => {
      renderAdminReminders();
      renderAdminOverdueTasks();
    });
  }
  if (adminReminderForm) adminReminderForm.addEventListener("submit", handleAdminReminderSubmit);
  if (adminReminderTargetMode) adminReminderTargetMode.addEventListener("change", syncAdminReminderTargetMode);
  if (adminAnnouncementForm) adminAnnouncementForm.addEventListener("submit", handleAdminAnnouncementSubmit);
  if (adminSecurityForm) adminSecurityForm.addEventListener("submit", handleAdminSecuritySubmit);
  adminTabButtons.forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab || "requirements"));
  });
  if (studentSubjectForm) studentSubjectForm.addEventListener("submit", handleStudentSubjectSubmit);
  if (studentTaskForm) studentTaskForm.addEventListener("submit", handleStudentTaskSubmit);
  if (studentTaskComposerToggle) studentTaskComposerToggle.addEventListener("click", () => setStudentTaskComposerOpen(true));
  if (studentTaskComposerCancel) studentTaskComposerCancel.addEventListener("click", () => setStudentTaskComposerOpen(false));
  if (studentPrintTasksBtn) studentPrintTasksBtn.addEventListener("click", printStudentIncompleteTasks);
  studentTabButtons.forEach((button) => {
    button.addEventListener("click", () => setStudentTab(button.dataset.studentTab || "tasks"));
  });
  if (PAGE === "student") {
    window.addEventListener("hashchange", syncStudentTabFromHash);
  }
}

async function bootstrap() {
  if (PAGE === "login" || PAGE === "register") {
    updateLoginHelpText();
    try {
      const session = await fetchSession();
      state.session = session;
      if (state.session.isLoggedIn) {
        redirectToRolePage(state.session);
      }
    } catch (error) {
      console.warn("TDMS session check skipped on login screen:", error);
    }
    return;
  }

  try {
    state.session = await fetchSession();
  } catch (error) {
    showError(error);
    redirect("index.html");
    return;
  }

  if (!state.session.isLoggedIn) {
    redirect("index.html");
    return;
  }

  try {
    if (PAGE === "admin") {
      if (state.session.role !== "staff") {
        redirectToRolePage(state.session);
        return;
      }
      await loadAdminData();
      renderAdminPage();
    }

    if (PAGE === "student") {
      if (state.session.role !== "student") {
        redirectToRolePage(state.session);
        return;
      }
      syncStudentTabFromHash();
      await loadStudentData();
      renderStudentPage();
    }
  } catch (error) {
    console.error("TDMS bootstrap failed:", error);
    throw error;
  }
}

async function loadAdminData() {
  const response = await apiRequest("admin-data");
  state.session = response.session;
  state.adminAccount = response.account || null;
  state.students = response.students || [];
  state.tasks = enrichTasks(response.tasks || []);
  state.announcements = enrichAnnouncements(response.announcements || []);
}

async function loadStudentData() {
  const response = await apiRequest("student-data");
  state.session = response.session;
  state.student = response.student || null;
  state.subjects = response.subjects || [];
  state.tasks = enrichTasks(response.tasks || []);
  state.announcements = enrichAnnouncements(response.announcements || []);
}

function enrichTasks(tasks) {
  return tasks.map((task) => {
    const daysUntilDue = getDaysUntilDue(task.dueDate);
    const displayStatus = task.status === "Completed"
      ? "Completed"
      : daysUntilDue < 0
        ? "Overdue"
        : "Pending";

    return {
      ...task,
      source: task.source || "admin",
      subject: task.subject || "",
      priority: task.priority || (task.source === "student" ? "Medium" : ""),
      studentName: task.studentName || "",
      daysUntilDue,
      displayStatus,
    };
  });
}

function enrichAnnouncements(announcements) {
  return announcements.map((announcement) => ({
    ...announcement,
    eventType: "announcement",
    daysUntilDue: getDaysUntilDue(announcement.eventDate),
  }));
}

function renderAdminPage() {
  if (adminHeaderRole) {
    adminHeaderRole.textContent = state.adminAccount?.username || "Admin";
  }
  if (adminHeaderName) {
    adminHeaderName.textContent = state.adminAccount?.fullName || state.session.userName || "Reminder center";
  }
  syncAdminReminderStudentOptions();
  syncAdminReminderTargetMode();
  renderAdminTabs();
  renderAdminReminders();
  renderAdminAnnouncements();
}

function syncAdminReminderStudentOptions() {
  if (!adminReminderStudent) return;
  const previousValue = adminReminderStudent.value;
  adminReminderStudent.innerHTML = "";

  if (!state.students.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No registered students yet";
    adminReminderStudent.appendChild(option);
    adminReminderStudent.disabled = true;
    return;
  }

  adminReminderStudent.disabled = false;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select student";
  adminReminderStudent.appendChild(placeholder);

  state.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = `${student.name} (${student.studentId})`;
    adminReminderStudent.appendChild(option);
  });

  adminReminderStudent.value = state.students.some((student) => String(student.id) === previousValue) ? previousValue : "";
}

function syncAdminReminderTargetMode() {
  const mode = adminReminderTargetMode?.value || "student";
  const byYear = mode === "year";

  if (adminReminderYearWrap) {
    adminReminderYearWrap.hidden = !byYear;
  }

  if (adminReminderYearLevel) {
    adminReminderYearLevel.disabled = !byYear;
    adminReminderYearLevel.required = byYear;
  }

  if (adminReminderStudent) {
    adminReminderStudent.disabled = byYear;
    adminReminderStudent.required = !byYear;
  }
}

function setAdminTab(tab) {
  state.currentAdminTab = ADMIN_TABS.has(tab) ? tab : "requirements";
  renderAdminTabs();
}

function renderAdminTabs() {
  adminTabButtons.forEach((button) => {
    const isActive = button.dataset.adminTab === state.currentAdminTab;
    button.classList.toggle("is-active", isActive);
  });

  adminTabPanels.forEach((panel) => {
    const isActive = panel.dataset.adminTabPanel === state.currentAdminTab;
    panel.classList.toggle("is-active", isActive);
  });

  if (adminSectionMenu) {
    adminSectionMenu.hidden = false;
  }
}

async function handleAdminReminderSubmit(event) {
  event.preventDefault();
  try {
    const formData = new FormData(adminReminderForm);
    const targetMode = String(formData.get("adminReminderTargetMode") ?? "student");
    const studentId = String(formData.get("adminReminderStudent") ?? "");
    const yearLevel = String(formData.get("adminReminderYearLevel") ?? "");
    const title = String(formData.get("adminReminderTitle") ?? "").trim();
    const dueDate = String(formData.get("adminReminderDueDate") ?? "");
    const notes = String(formData.get("adminReminderNotes") ?? "").trim();

    await apiRequest("add-admin-reminder", "POST", {
      targetMode,
      studentId,
      yearLevel,
      title,
      category: "Missing Requirement",
      priority: "High",
      dueDate,
      notes,
      subject: "",
    });
    adminReminderForm.reset();
    await loadAdminData();
    renderAdminPage();
  } catch (error) {
    showError(error);
  }
}

async function handleAdminAnnouncementSubmit(event) {
  event.preventDefault();
  if (!adminAnnouncementForm) return;

  try {
    const formData = new FormData(adminAnnouncementForm);
    const title = String(formData.get("adminAnnouncementTitle") ?? "").trim();
    const eventDate = String(formData.get("adminAnnouncementDate") ?? "");
    const message = String(formData.get("adminAnnouncementMessage") ?? "").trim();

    const response = await apiRequest("add-announcement", "POST", {
      title,
      eventDate,
      message,
    });
    adminAnnouncementForm.reset();
    await loadAdminData();
    renderAdminPage();
    if (response?.message) {
      window.alert(response.message);
    }
  } catch (error) {
    showError(error);
  }
}

function setFormStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function renderAdminSecurity() {
  if (adminSecurityUsername) {
    adminSecurityUsername.value = state.adminAccount?.username || "";
  }
  if (adminSecurityFullName) {
    adminSecurityFullName.value = state.adminAccount?.fullName || state.session.userName || "";
  }
  if (adminSecurityEmail) {
    adminSecurityEmail.value = state.adminAccount?.email || state.session.staffEmail || "";
  }

  const mustChangePassword = Boolean(state.session.mustChangePassword);
  if (adminSecurityNotice) {
    adminSecurityNotice.textContent = mustChangePassword
      ? "First login protection is active. Change your temporary password before using the admin tools."
      : "Keep your staff password strong and use only your official Asian College email.";
  }

  if (adminSecurityStatus && !adminSecurityStatus.dataset.userSet) {
    setFormStatus(
      adminSecurityStatus,
      mustChangePassword
        ? "Temporary password detected. Save a new password now to unlock the admin tools."
        : "Use at least 10 characters with letters and numbers."
    );
  }
}

function syncAdminSecurityLockState() {
  const locked = PAGE === "admin" && Boolean(state.session.mustChangePassword);
  if (seedDemoBtn) seedDemoBtn.disabled = locked;
  if (clearDataBtn) clearDataBtn.disabled = locked;
  if (taskSearch) taskSearch.disabled = locked;
  if (adminReminderForm) {
    [...adminReminderForm.elements].forEach((element) => {
      if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        element.disabled = locked;
      }
    });
  }
}

async function handleAdminSecuritySubmit(event) {
  event.preventDefault();
  if (!adminSecurityForm) return;

  try {
    setFormStatus(adminSecurityStatus, "Saving staff credentials...");
    if (adminSecurityStatus) adminSecurityStatus.dataset.userSet = "true";
    if (adminSecuritySubmit) {
      adminSecuritySubmit.disabled = true;
      adminSecuritySubmit.textContent = "Saving...";
    }

    const response = await apiRequest("change-staff-password", "POST", {
      username: adminSecurityUsername?.value.trim() || "",
      fullName: adminSecurityFullName?.value.trim() || "",
      email: adminSecurityEmail?.value.trim() || "",
      currentPassword: adminSecurityCurrentPassword?.value || "",
      newPassword: adminSecurityNewPassword?.value || "",
      confirmPassword: adminSecurityConfirmPassword?.value || "",
    });

    state.session = response.session || state.session;
    state.adminAccount = response.account || state.adminAccount;
    if (adminSecurityCurrentPassword) adminSecurityCurrentPassword.value = "";
    if (adminSecurityNewPassword) adminSecurityNewPassword.value = "";
    if (adminSecurityConfirmPassword) adminSecurityConfirmPassword.value = "";

    setFormStatus(adminSecurityStatus, response.message || "Staff credentials updated successfully.");
    renderAdminPage();
  } catch (error) {
    setFormStatus(adminSecurityStatus, error.message || "Unable to update staff credentials.", true);
    if (adminSecurityStatus) adminSecurityStatus.dataset.userSet = "true";
    showError(error);
  } finally {
    if (adminSecuritySubmit) {
      adminSecuritySubmit.disabled = false;
      adminSecuritySubmit.textContent = "Save staff credentials";
    }
  }
}

function renderAdminReminders() {
  if (!reminderList) return;
  const reminders = state.tasks
    .filter((task) => task.status !== "Completed" && task.source === "admin")
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  reminderList.innerHTML = "";

  if (!reminders.length) {
    reminderList.appendChild(emptyStateNode("No reminders found."));
    return;
  }

  reminders.forEach((task) => reminderList.appendChild(buildReminderCard(task, true)));
}

function renderAdminAnnouncements() {
  if (!adminAnnouncementList) return;
  adminAnnouncementList.innerHTML = "";

  if (!state.announcements.length) {
    adminAnnouncementList.appendChild(emptyStateNode("No announcements posted yet."));
    return;
  }

  state.announcements.forEach((announcement) => {
    adminAnnouncementList.appendChild(buildAnnouncementCard(announcement));
  });
}

function renderAdminOverdueTasks() {
  if (!adminOverdueList) return;
  const query = taskSearch ? taskSearch.value.trim().toLowerCase() : "";
  const overdueTasks = state.tasks
    .filter((task) => task.status !== "Completed" && task.daysUntilDue < 0)
    .filter((task) => [task.title, task.studentName, task.category, task.notes, task.priority, task.subject].join(" ").toLowerCase().includes(query))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  adminOverdueList.innerHTML = "";

  if (!overdueTasks.length) {
    adminOverdueList.appendChild(emptyStateNode("No overdue incomplete tasks right now."));
    return;
  }

  overdueTasks.forEach((task) => adminOverdueList.appendChild(buildReminderCard(task, true)));
}

function renderStudentPage() {
  if (studentHeaderId) studentHeaderId.textContent = `Student ID: ${state.student?.studentId || state.session.studentId || "-"}`;
  if (studentHeaderName) studentHeaderName.textContent = state.student?.name || state.session.userName || "Student Account";
  syncStudentTaskSubjectOptions();
  renderStudentTabs();
  renderStudentTaskComposer();
  renderFocus(state.tasks.filter((task) => task.status !== "Completed"));
  renderStudentSubjects();
  renderStudentTaskTable();
  renderStudentStats();
  renderStudentDocuments();
  renderStudentNotifications();
  renderStudentCalendar();
  renderStudentClassroom();
}

function setStudentTab(tab) {
  const nextTab = STUDENT_TABS.has(tab) ? tab : "tasks";
  const nextHash = `#${nextTab}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextTab;
    return;
  }
  state.currentStudentTab = nextTab;
  renderStudentTabs();
}

function syncStudentTabFromHash() {
  const hashTab = window.location.hash.replace("#", "").trim();
  state.currentStudentTab = STUDENT_TABS.has(hashTab) ? hashTab : "tasks";
  renderStudentTabs();
}

function renderStudentTabs() {
  studentTabButtons.forEach((button) => {
    const isActive = button.dataset.studentTab === state.currentStudentTab;
    button.classList.toggle("is-active", isActive);
  });

  studentTabPanels.forEach((panel) => {
    const isActive = panel.dataset.studentTabPanel === state.currentStudentTab;
    panel.classList.toggle("is-active", isActive);
  });
  if (studentSectionMenu) {
    studentSectionMenu.hidden = false;
  }
}

function setStudentTaskComposerOpen(nextOpen) {
  state.studentTaskComposerOpen = Boolean(nextOpen);
  renderStudentTaskComposer();
}

function renderStudentTaskComposer() {
  if (studentTaskComposer) {
    studentTaskComposer.hidden = !state.studentTaskComposerOpen;
  }

  if (studentTaskComposerBar) {
    studentTaskComposerBar.hidden = state.studentTaskComposerOpen;
  }

  if (studentTaskComposerToggle) {
    studentTaskComposerToggle.hidden = state.studentTaskComposerOpen;
  }
}

function syncStudentDashboardOptions() {
  return;
}

function syncStudentTaskSubjectOptions() {
  if (!studentTaskSubject) return;
  const previousValue = studentTaskSubject.value;
  studentTaskSubject.innerHTML = "";

  if (!state.subjects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a subject first";
    studentTaskSubject.appendChild(option);
    studentTaskSubject.disabled = true;
    return;
  }

  studentTaskSubject.disabled = false;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select subject";
  studentTaskSubject.appendChild(placeholder);

  state.subjects.forEach((subject) => {
    const option = document.createElement("option");
    option.value = subject.name;
    option.textContent = `${subject.name} (${subject.year}, ${subject.semester})`;
    studentTaskSubject.appendChild(option);
  });

  studentTaskSubject.value = state.subjects.some((subject) => subject.name === previousValue) ? previousValue : "";
}

async function handleStudentSubjectSubmit(event) {
  event.preventDefault();
  if (!studentSubjectForm) return;
  try {
    const formData = new FormData(studentSubjectForm);
    const subjectName = formData.get("studentSubjectName").toString().trim();
    const year = formData.get("studentSubjectYear").toString();
    const semester = formData.get("studentSubjectSemester").toString();
    if (studentSubjectStatus) {
      studentSubjectStatus.textContent = "Saving subject...";
      studentSubjectStatus.classList.remove("is-error");
    }
    if (studentSubjectSubmit) {
      studentSubjectSubmit.disabled = true;
      studentSubjectSubmit.textContent = "Saving...";
    }

    await apiRequest("add-student-subject", "POST", {
      year,
      semester,
      name: subjectName,
    });

    state.subjects = [
      {
        id: `local-${Date.now()}`,
        studentId: Number(state.session.studentId || 0),
        year,
        semester,
        name: subjectName,
      },
      ...state.subjects,
    ];

    studentSubjectForm.reset();
    syncStudentTaskSubjectOptions();
    renderStudentSubjects();
    if (studentSubjectStatus) {
      studentSubjectStatus.textContent = `${subjectName} added successfully.`;
      studentSubjectStatus.classList.remove("is-error");
    }
    window.alert("Subject added successfully.");

    try {
      await loadStudentData();
      renderStudentPage();
    } catch (refreshError) {
      console.error("Subject saved, but refresh failed:", refreshError);
    }
  } catch (error) {
    if (studentSubjectStatus) {
      studentSubjectStatus.textContent = error.message || "Subject save failed.";
      studentSubjectStatus.classList.add("is-error");
    }
    showError(error);
  } finally {
    if (studentSubjectSubmit) {
      studentSubjectSubmit.disabled = false;
      studentSubjectSubmit.textContent = "Save subject";
    }
  }
}

function renderStudentSubjects() {
  if (!studentSubjectList) return;
  studentSubjectList.innerHTML = "";

  if (!state.subjects.length) {
    studentSubjectList.appendChild(emptyStateNode("No subjects added yet for this student."));
    return;
  }

  state.subjects.forEach((subject) => {
    const card = document.createElement("article");
    card.className = "subject-card";
    card.innerHTML = `
      <strong>${escapeHtml(subject.name)}</strong>
      <span>${escapeHtml(subject.year)} · ${escapeHtml(subject.semester)}</span>
    `;
    studentSubjectList.appendChild(card);
  });
}

async function handleStudentTaskSubmit(event) {
  event.preventDefault();
  try {
    const formData = new FormData(studentTaskForm);
    const subject = formData.get("studentTaskSubject").toString();
    const category = formData.get("studentTaskCategory").toString();
    await apiRequest("add-student-task", "POST", {
      title: `${subject} - ${category}`,
      subject,
      category,
      priority: formData.get("studentTaskPriority").toString(),
      dueDate: formData.get("studentTaskDueDate").toString(),
      notes: formData.get("studentTaskNotes").toString().trim(),
    });
    studentTaskForm.reset();
    setStudentTaskComposerOpen(false);
    await loadStudentData();
    renderStudentPage();
  } catch (error) {
    showError(error);
  }
}

function renderStudentProfile() {
  if (!studentProfileCard) return;
  studentProfileCard.innerHTML = "";

  if (!state.student) {
    studentProfileCard.appendChild(emptyStateNode("No student record is available for this login."));
    return;
  }

  const completed = state.tasks.filter((task) => task.status === "Completed").length;
  const profile = document.createElement("div");
  profile.innerHTML = `
    <h4>${escapeHtml(state.student.name)}</h4>
    <p><strong>Student ID:</strong> ${escapeHtml(state.student.studentId)}</p>
    <p><strong>Program:</strong> ${escapeHtml(state.student.program)}</p>
    <p><strong>Contact:</strong> ${escapeHtml(state.student.contact || "-")}</p>
    <p><strong>Completion:</strong> ${completed} of ${state.tasks.length} tasks completed</p>
  `;
  studentProfileCard.appendChild(profile);
}

function renderStudentReminders() {
  if (!studentReminderList) return;
  const reminders = state.tasks
    .filter(shouldSendStudentReminder)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  studentReminderList.innerHTML = "";

  if (!reminders.length) {
    studentReminderList.appendChild(emptyStateNode("No urgent deadlines for this student."));
    return;
  }

  reminders.forEach((task) => studentReminderList.appendChild(buildReminderCard(task, false)));
}

function renderStudentDocuments() {
  if (!studentDocumentList) return;
  const documents = getMissingDocumentTasks();
  studentDocumentList.innerHTML = "";

  if (!documents.length) {
    studentDocumentList.appendChild(emptyStateNode("No missing document items right now."));
    return;
  }

  documents.forEach((task) => studentDocumentList.appendChild(buildReminderCard(task, false)));
}

function renderStudentNotifications() {
  if (!studentNotificationList) return;
  const announcements = state.announcements
    .slice()
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  const notifications = getStudentDeadlineNotifications();
  studentNotificationList.innerHTML = "";

  if (!announcements.length && !notifications.length) {
    studentNotificationList.appendChild(emptyStateNode("No announcements or deadline notifications right now."));
    return;
  }

  announcements.forEach((announcement) => studentNotificationList.appendChild(buildStudentAnnouncementCard(announcement)));
  notifications.forEach((task) => studentNotificationList.appendChild(buildReminderCard(task, false)));
}

function renderStudentCalendar() {
  if (!studentCalendarGrid || !studentCalendarAgenda || !studentCalendarMonthLabel) return;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const eventsByDate = new Map();

  state.tasks.forEach((task) => {
    const due = new Date(`${task.dueDate}T00:00:00`);
    if (due.getFullYear() !== year || due.getMonth() !== month) return;
    const day = due.getDate();
    if (!eventsByDate.has(day)) eventsByDate.set(day, []);
    eventsByDate.get(day).push({
      ...task,
      eventType: "task",
      eventDate: task.dueDate,
    });
  });

  state.announcements.forEach((announcement) => {
    const eventDate = parseTaskDate(announcement.eventDate);
    if (!eventDate || eventDate.getFullYear() !== year || eventDate.getMonth() !== month) return;
    const day = eventDate.getDate();
    if (!eventsByDate.has(day)) eventsByDate.set(day, []);
    eventsByDate.get(day).push(announcement);
  });

  studentCalendarMonthLabel.textContent = firstDay.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  studentCalendarGrid.innerHTML = "";

  for (let index = 0; index < startOffset; index += 1) {
    const blank = document.createElement("div");
    blank.className = "calendar-cell is-empty";
    studentCalendarGrid.appendChild(blank);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const cell = document.createElement("article");
    const isToday = day === today.getDate();
    const eventsForDay = eventsByDate.get(day) || [];
    cell.className = `calendar-cell${isToday ? " is-today" : ""}`;

    const itemsMarkup = eventsForDay.slice(0, 3).map((item) => `
      <span class="calendar-pill ${item.eventType === "announcement" ? "announcement" : item.displayStatus.toLowerCase()}">${escapeHtml(item.title)}</span>
    `).join("");

    cell.innerHTML = `
      <div class="calendar-date-line">
        <strong>${day}</strong>
        <span>${eventsForDay.length ? `${eventsForDay.length} item(s)` : ""}</span>
      </div>
      <div class="calendar-cell-items">
        ${itemsMarkup || '<span class="calendar-empty">No deadline</span>'}
      </div>
    `;
    studentCalendarGrid.appendChild(cell);
  }

  const agendaItems = [
    ...state.tasks.map((task) => ({ ...task, eventType: "task", eventDate: task.dueDate })),
    ...state.announcements.map((announcement) => ({
      ...announcement,
      dueDate: announcement.eventDate,
      subject: "Announcement",
      category: "Announcement",
      daysUntilDue: getDaysUntilDue(announcement.eventDate),
    })),
  ]
    .slice()
    .sort((a, b) => getDaysUntilDue(a.eventDate) - getDaysUntilDue(b.eventDate))
    .slice(0, 8);

  studentCalendarAgenda.innerHTML = "";

  if (!agendaItems.length) {
    studentCalendarAgenda.appendChild(emptyStateNode("No upcoming deadlines to show."));
    return;
  }

  agendaItems.forEach((task) => {
    const item = document.createElement("article");
    item.className = "calendar-agenda-item";
    item.innerHTML = `
      <strong>${escapeHtml(task.title)}</strong>
      <span>${escapeHtml(formatDate(task.dueDate))}</span>
      <small>${escapeHtml(task.subject || task.category)} • ${escapeHtml(formatCompactDue(task.daysUntilDue))}</small>
    `;
    studentCalendarAgenda.appendChild(item);
  });
}

async function loadGoogleClassroom(forcePrompt = false) {
  state.classroom.loading = true;
  state.classroom.error = "";
  renderStudentClassroom();

  try {
    const snapshot = await fetchGoogleClassroomSnapshot(forcePrompt ? "consent" : "select_account");
    state.classroom.courses = snapshot.courses || [];
    state.classroom.courseWork = snapshot.courseWork || [];
    state.classroom.loaded = true;
  } catch (error) {
    state.classroom.error = error.message || "Google Classroom could not be loaded.";
  } finally {
    state.classroom.loading = false;
    renderStudentClassroom();
  }
}

function formatGoogleClassroomDueDate(item) {
  const dueDate = item?.dueDate;
  if (!dueDate || !dueDate.year || !dueDate.month || !dueDate.day) return "No due date";
  const hours = Number(item?.dueTime?.hours || 0);
  const minutes = Number(item?.dueTime?.minutes || 0);
  const date = new Date(dueDate.year, dueDate.month - 1, dueDate.day, hours, minutes);
  return Number.isNaN(date.getTime())
    ? "No due date"
      : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getClassroomCourseInitials(course) {
  const source = String(course?.name || "GC")
    .replace(/[^\w\s]/g, " ")
    .trim();

  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "GC";
}

function getClassroomTeacherLine(course) {
  return course.section || course.descriptionHeading || "Google Classroom";
}

function renderStudentClassroom() {
  if (!studentClassroomList) return;
  studentClassroomList.innerHTML = "";
  const classroomConfig = getGoogleClassroomConfig();

  if (!classroomConfig.clientId) {
    const card = document.createElement("article");
    card.className = "classroom-connect-card";
    card.innerHTML = `
      <strong>Google Classroom is not configured yet.</strong>
      <p>Add your <code>clientId</code> and optional <code>apiKey</code> inside <code>auth.js</code> to activate this panel.</p>
      <small>Use the <code>GOOGLE_CLASSROOM_CONFIG</code> block near the top of the file.</small>
    `;
    studentClassroomList.appendChild(card);
    return;
  }

  if (state.classroom.loading) {
    const card = document.createElement("article");
    card.className = "classroom-connect-card";
    card.innerHTML = `
      <strong>Connecting to Google Classroom...</strong>
      <p>Please wait while TDMS loads your classes and coursework.</p>
    `;
    studentClassroomList.appendChild(card);
    return;
  }

  if (state.classroom.error) {
    const card = document.createElement("article");
    card.className = "classroom-connect-card";
    card.innerHTML = `
      <strong>Google Classroom connection failed.</strong>
      <p>${escapeHtml(state.classroom.error)}</p>
      <small>You can try connecting again once your Google client ID is ready.</small>
      <button class="primary-button" type="button" data-action="connect-classroom">Connect Google Classroom</button>
    `;
    studentClassroomList.appendChild(card);
    return;
  }

  if (!state.classroom.loaded) {
    const card = document.createElement("article");
    card.className = "classroom-connect-card";
    card.innerHTML = `
      <strong>Connect Google Classroom</strong>
      <p>Authorize your Google account to view your classes, assignments, and due dates inside TDMS.</p>
      <small>This uses your Google Classroom student account.</small>
      <button class="primary-button" type="button" data-action="connect-classroom">Connect Google Classroom</button>
    `;
    studentClassroomList.appendChild(card);
    return;
  }

  const wrapper = document.createElement("div");

  const summaryStrip = document.createElement("div");
  summaryStrip.className = "classroom-summary-strip";
  summaryStrip.innerHTML = `
    <article class="classroom-summary-box">
      <strong>${state.classroom.courses.length}</strong>
      <span>Classes</span>
    </article>
    <article class="classroom-summary-box">
      <strong>${state.classroom.courseWork.length}</strong>
      <span>Assignments</span>
    </article>
    <article class="classroom-summary-box">
      <strong>${state.classroom.courseWork.filter((item) => item?.dueDate).length}</strong>
      <span>With due dates</span>
    </article>
  `;
  wrapper.appendChild(summaryStrip);

  if (!state.classroom.courses.length) {
    wrapper.appendChild(emptyStateNode("No Google Classroom classes were found for this student."));
    studentClassroomList.appendChild(wrapper);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "classroom-catalog";

  state.classroom.courses.forEach((course) => {
    const relatedWork = state.classroom.courseWork.filter((item) => String(item.courseId) === String(course.id)).slice(0, 3);
    const courseCard = document.createElement("article");
    courseCard.className = "classroom-course-tile";
    courseCard.innerHTML = `
      <div class="classroom-course-cover">
        <h4 class="classroom-course-title">${escapeHtml(course.name || "Untitled class")}</h4>
        <p class="classroom-course-subtitle">${escapeHtml(getClassroomTeacherLine(course))}</p>
        <p class="classroom-course-meta">${escapeHtml(course.courseState || "ACTIVE")}</p>
        <div class="classroom-course-avatar">${escapeHtml(getClassroomCourseInitials(course))}</div>
      </div>

      <div class="classroom-course-body ${relatedWork.length ? "" : "empty"}">
        ${
          relatedWork.length
            ? relatedWork.map((item) => `
              <article class="classroom-course-work">
                <strong>${escapeHtml(item.title || "Untitled coursework")}</strong>
                <span>${escapeHtml(formatGoogleClassroomDueDate(item))}</span>
                <small>${escapeHtml(item.workType || "Course work")}</small>
              </article>
            `).join("")
            : `<p>No recent coursework in this class yet.</p>`
        }
      </div>

      <div class="classroom-course-footer">
        <span>${relatedWork.length} recent item(s)</span>
        <div class="classroom-course-actions">
          <button class="classroom-mini-button" type="button" data-action="reload-classroom">Refresh</button>
        </div>
      </div>
    `;
    grid.appendChild(courseCard);
  });

  wrapper.appendChild(grid);
  studentClassroomList.appendChild(wrapper);
}

function renderStudentTaskTable() {
  if (!studentTaskTableBody) return;
  studentTaskTableBody.innerHTML = "";

  if (!state.tasks.length) {
    studentTaskTableBody.append(emptyStateRow(5));
    return;
  }

  state.tasks
    .slice()
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .forEach((task) => {
      const sourceLabel = task.source === "admin" ? "Admin reminder" : "My task";
      const metaParts = [];
      if (task.subject) metaParts.push(task.subject);
      metaParts.push(task.category);
      if (task.priority) metaParts.push(`${task.priority} priority`);
      metaParts.push(sourceLabel);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(task.title)}</strong>
          <div>${escapeHtml(metaParts.join(" · "))}</div>
        </td>
        <td>${escapeHtml(formatDate(task.dueDate))}</td>
        <td><span class="tag ${task.displayStatus.toLowerCase()}">${task.displayStatus}</span></td>
        <td>${escapeHtml(task.notes || "-")}</td>
        <td>
          <button class="status-button" type="button" data-action="toggle-task" data-id="${task.id}">
            ${task.status === "Completed" ? "Mark pending" : "Mark complete"}
          </button>
        </td>
      `;
      studentTaskTableBody.appendChild(tr);
    });
}

function renderStudentStats() {
  if (studentPendingCount) studentPendingCount.textContent = state.tasks.filter((task) => task.displayStatus === "Pending").length.toString();
  if (studentCompletedCount) studentCompletedCount.textContent = state.tasks.filter((task) => task.displayStatus === "Completed").length.toString();
  if (studentDueSoonCount) {
    studentDueSoonCount.textContent = state.tasks.filter((task) => task.status !== "Completed" && task.daysUntilDue >= 0 && task.daysUntilDue <= 3).length.toString();
  }
  if (studentOverdueCount) {
    studentOverdueCount.textContent = state.tasks.filter((task) => task.status !== "Completed" && task.daysUntilDue < 0).length.toString();
  }
}

function printStudentIncompleteTasks() {
  const incompleteTasks = state.tasks
    .filter((task) => task.status !== "Completed")
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  if (!incompleteTasks.length) {
    window.alert("No incomplete tasks to print.");
    return;
  }

  const studentName = state.student?.name || state.session.userName || "Student";
  const studentId = state.student?.studentId || state.session.studentId || "";
  const rows = incompleteTasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.title)}</td>
      <td>${escapeHtml(task.subject || "-")}</td>
      <td>${escapeHtml(task.category || "-")}</td>
      <td>${escapeHtml(formatDate(task.dueDate))}</td>
      <td>${escapeHtml(task.displayStatus)}</td>
      <td>${escapeHtml(task.notes || "-")}</td>
    </tr>
  `).join("");

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    window.alert("Please allow pop-ups to print your task list.");
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>TDMS Tasks to Complete</title>
      <style>
        body {
          font-family: Calibri, Arial, Helvetica, sans-serif;
          color: #111;
          margin: 28px;
        }

        h1 {
          margin: 0 0 6px;
          font-size: 24px;
        }

        .meta {
          margin-bottom: 22px;
          color: #444;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th,
        td {
          border: 1px solid #bbb;
          padding: 9px;
          text-align: left;
          vertical-align: top;
          font-size: 13px;
        }

        th {
          background: #eef5f0;
        }

        @media print {
          body {
            margin: 18px;
          }
        }
      </style>
    </head>
    <body>
      <h1>TDMS Tasks to Complete</h1>
      <div class="meta">
        <strong>Student:</strong> ${escapeHtml(studentName)}
        ${studentId ? ` | <strong>ID:</strong> ${escapeHtml(studentId)}` : ""}
        | <strong>Date:</strong> ${escapeHtml(new Date().toLocaleDateString())}
      </div>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Subject</th>
            <th>Category</th>
            <th>Due date</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <script>
        window.addEventListener("load", () => {
          window.print();
        });
      <\/script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

function getMissingDocumentTasks() {
  return state.tasks
    .filter((task) => {
      const category = (task.category || "").toLowerCase();
      const title = (task.title || "").toLowerCase();
      return task.status !== "Completed" && (
        category.includes("document") ||
        category.includes("requirement") ||
        title.includes("missing")
      );
    })
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function shouldSendStudentReminder(task) {
  return task.status !== "Completed" && STUDENT_REMINDER_DAYS.has(task.daysUntilDue);
}

function getStudentDeadlineNotifications() {
  return state.tasks
    .filter(shouldSendStudentReminder)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function renderFocus(tasks) {
  if (!focusList) return;
  const items = tasks.slice().sort((a, b) => a.daysUntilDue - b.daysUntilDue).slice(0, 4);
  focusList.innerHTML = "";

  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "No urgent tasks yet.";
    focusList.appendChild(li);
    return;
  }

  items.forEach((task) => {
    const li = document.createElement("li");
    li.textContent = task.studentName
      ? `${task.studentName}: ${task.title} (${formatCompactDue(task.daysUntilDue)})`
      : `${task.title} (${formatCompactDue(task.daysUntilDue)})`;
    focusList.appendChild(li);
  });
}

function buildReminderCard(task, includeStudent) {
  const card = document.createElement("article");
  const reminderClass = task.daysUntilDue < 0 ? "danger" : "warning";
  const timingLabel = task.daysUntilDue < 0
    ? `${Math.abs(task.daysUntilDue)} day(s) overdue`
    : task.daysUntilDue === 0
      ? "Due today"
      : `Due in ${task.daysUntilDue} day(s)`;
  const studentLine = includeStudent ? `<span>Student: ${escapeHtml(task.studentName || "Unknown student")}</span>` : "";
  const metaLine = [task.subject, task.priority ? `${task.priority} priority` : "", task.category]
    .filter(Boolean)
    .join(" · ");

  card.className = `reminder-card ${reminderClass}`;
  card.innerHTML = `
    <strong>${escapeHtml(task.title)}</strong>
    ${studentLine}
    <span>${escapeHtml(metaLine || "Task")}</span>
    <span>Deadline: ${escapeHtml(formatDate(task.dueDate))}</span>
    <span>${escapeHtml(timingLabel)}</span>
    <span>${escapeHtml(task.notes || "No notes added.")}</span>
  `;
  return card;
}

function buildAnnouncementCard(announcement) {
  const card = document.createElement("article");
  card.className = "reminder-card warning";
  card.innerHTML = `
    <strong>${escapeHtml(announcement.title)}</strong>
    <span>Calendar date: ${escapeHtml(formatDate(announcement.eventDate))}</span>
    <span>Posted by: ${escapeHtml(announcement.createdByName || "Admin")}</span>
    <span>${escapeHtml(announcement.message || "No details added.")}</span>
  `;
  return card;
}

function buildStudentAnnouncementCard(announcement) {
  const card = document.createElement("article");
  const timingLabel = announcement.daysUntilDue < 0
    ? `Posted ${Math.abs(announcement.daysUntilDue)} day(s) ago`
    : announcement.daysUntilDue === 0
      ? "Happening today"
      : `In ${announcement.daysUntilDue} day(s)`;

  card.className = "reminder-card warning";
  card.innerHTML = `
    <strong>${escapeHtml(announcement.title)}</strong>
    <span>Announcement</span>
    <span>Date: ${escapeHtml(formatDate(announcement.eventDate))}</span>
    <span>${escapeHtml(timingLabel)}</span>
    <span>${escapeHtml(announcement.message || "No details added.")}</span>
  `;
  return card;
}

async function seedDemoData() {
  try {
    await apiRequest("seed-demo", "POST", {});
    if (PAGE === "admin") {
      await loadAdminData();
      renderAdminPage();
    }
    if (PAGE === "student") {
      await loadStudentData();
      renderStudentPage();
    }
  } catch (error) {
    showError(error);
  }
}

async function clearAllData() {
  const confirmed = window.confirm("Delete all saved students, subjects, and tasks from MySQL?");
  if (!confirmed) return;

  try {
    await apiRequest("clear-data", "POST", {});
    if (PAGE === "admin") {
      await loadAdminData();
      renderAdminPage();
    }
  } catch (error) {
    showError(error);
  }
}

function parseTaskDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const candidate = normalized.includes("T") ? normalized : `${normalized}T00:00:00`;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDaysUntilDue(dueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = parseTaskDate(dueDate);
  if (!due) return Number.POSITIVE_INFINITY;
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

function formatDate(dateString) {
  const date = parseTaskDate(dateString);
  if (!date) return "No due date";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCompactDue(daysUntilDue) {
  if (daysUntilDue < 0) return `${Math.abs(daysUntilDue)}d overdue`;
  if (daysUntilDue === 0) return "today";
  return `${daysUntilDue}d left`;
}

function emptyStateRow(columns) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = columns;
  td.appendChild(emptyStateNode());
  tr.appendChild(td);
  return tr;
}

function emptyStateNode(message = "No records available yet.") {
  const node = emptyStateTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("p").textContent = message;
  return node;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(error) {
  console.error(error);
  alert(error.message || "Something went wrong.");
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "connect-classroom") {
    try {
      await loadGoogleClassroom(true);
    } catch (error) {
      showError(error);
    }
    return;
  }

  if (action === "reload-classroom") {
    try {
      await loadGoogleClassroom(false);
    } catch (error) {
      showError(error);
    }
    return;
  }

  if (action !== "toggle-task") return;

  try {
    await apiRequest("toggle-task", "POST", { taskId: id });
    if (PAGE === "student") {
      await loadStudentData();
      renderStudentPage();
    }
    if (PAGE === "admin") {
      await loadAdminData();
      renderAdminPage();
    }
  } catch (error) {
    showError(error);
  }
});
})().catch((error) => {
  console.error(error);
  alert(error.message || "Something went wrong.");
});

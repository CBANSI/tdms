<?php

declare(strict_types=1);

header('Content-Type: application/json');
session_start();

require __DIR__ . '/db.php';

function json_input(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function current_session(): array
{
    return [
        'isLoggedIn' => !empty($_SESSION['user']),
        'role' => $_SESSION['user']['role'] ?? '',
        'userName' => $_SESSION['user']['userName'] ?? '',
        'studentId' => $_SESSION['user']['studentId'] ?? '',
        'adminId' => $_SESSION['user']['adminId'] ?? '',
        'staffEmail' => $_SESSION['user']['staffEmail'] ?? '',
        'mustChangePassword' => (bool)($_SESSION['user']['mustChangePassword'] ?? false),
    ];
}

function set_session_user(string $role, string $userName, string $studentId = '', array $extra = []): array
{
    $_SESSION['user'] = array_merge([
        'role' => $role,
        'userName' => $userName,
        'studentId' => $studentId,
    ], $extra);

    return current_session();
}

function require_login(?string $role = null): array
{
    if (empty($_SESSION['user'])) {
        respond(['ok' => false, 'message' => 'Not authenticated.'], 401);
    }

    if ($role !== null && ($_SESSION['user']['role'] ?? '') !== $role) {
        respond(['ok' => false, 'message' => 'Access denied.'], 403);
    }

    return $_SESSION['user'];
}

function normalize_email(?string $value): ?string
{
    $email = trim(mb_strtolower((string)$value));
    return $email === '' ? null : $email;
}

function require_valid_email(?string $email): ?string
{
    if ($email === null) {
        return null;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['ok' => false, 'message' => 'Please enter a valid email address.'], 422);
    }

    return $email;
}

function app_config(): array
{
    return tdms_config();
}

function public_client_config(): array
{
    $config = app_config();
    $googleClientId = trim((string)($config['google_client_id'] ?? ''));

    return [
        'googleEnabled' => $googleClientId !== '',
        'googleClientId' => $googleClientId,
    ];
}

function student_columns(PDO $pdo): array
{
    static $columns = null;
    if (is_array($columns)) {
        return $columns;
    }

    $stmt = $pdo->query('SHOW COLUMNS FROM students');
    $columns = [];
    foreach ($stmt->fetchAll() as $column) {
        $columns[$column['Field']] = true;
    }

    return $columns;
}

function student_has_column(PDO $pdo, string $column): bool
{
    $columns = student_columns($pdo);
    return isset($columns[$column]);
}

function student_select_columns(PDO $pdo, string $prefix = ''): string
{
    $p = $prefix === '' ? '' : rtrim($prefix, '.') . '.';
    $columns = [
        "{$p}id",
        "{$p}student_id",
        "{$p}full_name",
        "{$p}program",
        "{$p}contact",
    ];

    if (student_has_column($pdo, 'email')) {
        $columns[] = "{$p}email";
    }
    if (student_has_column($pdo, 'password_hash')) {
        $columns[] = "{$p}password_hash";
    }
    if (student_has_column($pdo, 'auth_provider')) {
        $columns[] = "{$p}auth_provider";
    }
    if (student_has_column($pdo, 'google_sub')) {
        $columns[] = "{$p}google_sub";
    }

    return implode(', ', $columns);
}

function admin_columns(PDO $pdo, bool $refresh = false): array
{
    static $columns = null;
    if (!$refresh && is_array($columns)) {
        return $columns;
    }

    $stmt = $pdo->query('SHOW COLUMNS FROM admins');
    $columns = [];
    foreach ($stmt->fetchAll() as $column) {
        $columns[$column['Field']] = true;
    }

    return $columns;
}

function admin_has_column(PDO $pdo, string $column): bool
{
    $columns = admin_columns($pdo);
    return isset($columns[$column]);
}

function ensure_admin_security_schema(PDO $pdo): void
{
    $columns = admin_columns($pdo, true);

    if (!isset($columns['email'])) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN email VARCHAR(190) NULL AFTER full_name');
    }
    if (!isset($columns['must_change_password'])) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 1 AFTER email');
    }
    if (!isset($columns['failed_login_attempts'])) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0 AFTER must_change_password');
    }
    if (!isset($columns['lock_until'])) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN lock_until DATETIME NULL AFTER failed_login_attempts');
    }
    if (!isset($columns['password_changed_at'])) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN password_changed_at DATETIME NULL AFTER lock_until');
    }

    admin_columns($pdo, true);
}

function is_password_hash_string(?string $value): bool
{
    if ($value === null) {
        return false;
    }

    return str_starts_with($value, '$2y$')
        || str_starts_with($value, '$2a$')
        || str_starts_with($value, '$argon2i$')
        || str_starts_with($value, '$argon2id$');
}

function upgrade_legacy_admin_passwords(PDO $pdo): void
{
    ensure_admin_security_schema($pdo);

    $stmt = $pdo->query('SELECT id, password_hash FROM admins');
    $updateStmt = $pdo->prepare('UPDATE admins SET password_hash = :password_hash, must_change_password = 1 WHERE id = :id');

    foreach ($stmt->fetchAll() as $admin) {
        $legacyPassword = (string)($admin['password_hash'] ?? '');
        if ($legacyPassword === '' || is_password_hash_string($legacyPassword)) {
            continue;
        }

        $updateStmt->execute([
            'password_hash' => password_hash($legacyPassword, PASSWORD_DEFAULT),
            'id' => (int)$admin['id'],
        ]);
    }
}

function require_valid_staff_email(?string $email): ?string
{
    $normalized = require_valid_email(normalize_email($email));
    if ($normalized === null || $normalized === '') {
        return null;
    }

    if (!str_ends_with($normalized, '@asiancollege.edu.ph')) {
        respond(['ok' => false, 'message' => 'Staff email must use the @asiancollege.edu.ph domain.'], 422);
    }

    return $normalized;
}

function fetch_admin_record(PDO $pdo, int $adminId): ?array
{
    ensure_admin_security_schema($pdo);

    $stmt = $pdo->prepare('
        SELECT id, username, full_name, email, password_hash, must_change_password, failed_login_attempts, lock_until, password_changed_at
        FROM admins
        WHERE id = :id
        LIMIT 1
    ');
    $stmt->execute(['id' => $adminId]);
    $admin = $stmt->fetch();
    return $admin ?: null;
}

function find_admin_for_login(PDO $pdo, string $username): ?array
{
    ensure_admin_security_schema($pdo);

    $stmt = $pdo->prepare('
        SELECT id, username, full_name, email, password_hash, must_change_password, failed_login_attempts, lock_until, password_changed_at
        FROM admins
        WHERE username = :username
        LIMIT 1
    ');
    $stmt->execute(['username' => trim($username)]);
    $admin = $stmt->fetch();
    return $admin ?: null;
}

function login_admin_session(array $admin): array
{
    return set_session_user('staff', (string)$admin['full_name'], '', [
        'adminId' => (string)$admin['id'],
        'staffEmail' => (string)($admin['email'] ?? ''),
        'mustChangePassword' => (bool)($admin['must_change_password'] ?? false),
    ]);
}

function fetch_admin_profile(PDO $pdo, int $adminId): ?array
{
    $admin = fetch_admin_record($pdo, $adminId);
    if (!$admin) {
        return null;
    }

    return [
        'id' => (int)$admin['id'],
        'username' => (string)$admin['username'],
        'fullName' => (string)$admin['full_name'],
        'email' => (string)($admin['email'] ?? ''),
        'mustChangePassword' => (bool)($admin['must_change_password'] ?? false),
        'passwordChangedAt' => $admin['password_changed_at'] ?? null,
    ];
}

function admin_is_locked(array $admin): bool
{
    $lockUntil = trim((string)($admin['lock_until'] ?? ''));
    if ($lockUntil === '') {
        return false;
    }

    return strtotime($lockUntil) !== false && strtotime($lockUntil) > time();
}

function reset_admin_login_attempts(PDO $pdo, int $adminId): void
{
    $stmt = $pdo->prepare('UPDATE admins SET failed_login_attempts = 0, lock_until = NULL WHERE id = :id');
    $stmt->execute(['id' => $adminId]);
}

function register_admin_login_failure(PDO $pdo, array $admin): void
{
    $attempts = (int)($admin['failed_login_attempts'] ?? 0) + 1;
    $lockUntil = $attempts >= 5 ? date('Y-m-d H:i:s', strtotime('+15 minutes')) : null;

    $stmt = $pdo->prepare('UPDATE admins SET failed_login_attempts = :failed_login_attempts, lock_until = :lock_until WHERE id = :id');
    $stmt->execute([
        'failed_login_attempts' => $attempts,
        'lock_until' => $lockUntil,
        'id' => (int)$admin['id'],
    ]);
}

function require_staff_password_updated(): array
{
    $session = require_login('staff');
    if (!empty($session['mustChangePassword'])) {
        respond([
            'ok' => false,
            'message' => 'Please change your temporary staff password before using admin tools.',
            'mustChangePassword' => true,
        ], 423);
    }

    return $session;
}

function fetch_students(PDO $pdo): array
{
    $emailSelect = student_has_column($pdo, 'email') ? 'email' : '"" AS email';
    $stmt = $pdo->query("SELECT id, student_id AS studentId, full_name AS name, program, {$emailSelect}, contact FROM students ORDER BY full_name");
    return $stmt->fetchAll();
}

function fetch_subjects(PDO $pdo, ?int $studentId = null): array
{
    if ($studentId === null) {
        $stmt = $pdo->query('SELECT id, student_id AS studentId, year_level AS year, semester, name FROM subjects ORDER BY created_at DESC');
        return $stmt->fetchAll();
    }

    $stmt = $pdo->prepare('SELECT id, student_id AS studentId, year_level AS year, semester, name FROM subjects WHERE student_id = :student_id ORDER BY created_at DESC');
    $stmt->execute(['student_id' => $studentId]);
    return $stmt->fetchAll();
}

function fetch_tasks(PDO $pdo, ?int $studentId = null): array
{
    $sql = '
        SELECT
            t.id,
            t.student_id AS studentId,
            s.full_name AS studentName,
            t.subject_name AS subject,
            t.title,
            t.category,
            t.priority,
            t.due_date AS dueDate,
            t.notes,
            t.status,
            t.source,
            t.created_at AS createdAt,
            t.completed_at AS completedAt
        FROM tasks t
        INNER JOIN students s ON s.id = t.student_id
    ';

    if ($studentId !== null) {
        $sql .= ' WHERE t.student_id = :student_id';
    }

    $sql .= ' ORDER BY t.due_date ASC, t.created_at DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($studentId === null ? [] : ['student_id' => $studentId]);
    return $stmt->fetchAll();
}

function fetch_student_profile(PDO $pdo, int $studentId): ?array
{
    $select = student_select_columns($pdo);
    $stmt = $pdo->prepare("SELECT {$select} FROM students WHERE id = :id");
    $stmt->execute(['id' => $studentId]);
    $student = $stmt->fetch();
    if (!$student) {
        return null;
    }

    return [
        'id' => $student['id'],
        'studentId' => $student['student_id'],
        'name' => $student['full_name'],
        'program' => $student['program'],
        'contact' => $student['contact'],
        'email' => $student['email'] ?? '',
    ];
}

function fetch_student_record(PDO $pdo, int $studentId): ?array
{
    $select = student_select_columns($pdo);
    $stmt = $pdo->prepare("SELECT {$select} FROM students WHERE id = :id LIMIT 1");
    $stmt->execute(['id' => $studentId]);
    $student = $stmt->fetch();
    return $student ?: null;
}

function find_student_for_login(PDO $pdo, string $identifier): ?array
{
    $select = student_select_columns($pdo);
    if (student_has_column($pdo, 'email')) {
        $stmt = $pdo->prepare("SELECT {$select} FROM students WHERE student_id = :identifier OR email = :email LIMIT 1");
        $stmt->execute([
            'identifier' => trim($identifier),
            'email' => normalize_email($identifier),
        ]);
    } else {
        $stmt = $pdo->prepare("SELECT {$select} FROM students WHERE student_id = :identifier LIMIT 1");
        $stmt->execute([
            'identifier' => trim($identifier),
        ]);
    }

    $student = $stmt->fetch();
    return $student ?: null;
}

function find_student_for_google(PDO $pdo, string $email, string $googleSub): ?array
{
    if (!student_has_column($pdo, 'email') || !student_has_column($pdo, 'google_sub')) {
        return null;
    }

    $select = student_select_columns($pdo);
    $stmt = $pdo->prepare("SELECT {$select} FROM students WHERE google_sub = :google_sub OR email = :email LIMIT 1");
    $stmt->execute([
        'google_sub' => $googleSub,
        'email' => $email,
    ]);

    $student = $stmt->fetch();
    return $student ?: null;
}

function generate_student_identifier(PDO $pdo): string
{
    do {
        $candidate = sprintf(
            '%04d-%03d-%05d',
            (int)date('Y'),
            random_int(100, 999),
            random_int(10000, 99999)
        );
        $stmt = $pdo->prepare('SELECT id FROM students WHERE student_id = :student_id LIMIT 1');
        $stmt->execute(['student_id' => $candidate]);
    } while ($stmt->fetch());

    return $candidate;
}

function login_student_session(array $student): array
{
    return set_session_user('student', (string)$student['full_name'], (string)$student['id']);
}

function fetch_remote_json(string $url): array
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);

    $response = @file_get_contents($url, false, $context);

    if ($response === false && function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        $response = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $status >= 400) {
            throw new RuntimeException('Unable to contact Google sign-in services right now.');
        }
    }

    if ($response === false) {
        throw new RuntimeException('Unable to contact Google sign-in services right now.');
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid response from Google sign-in services.');
    }

    if (isset($decoded['error_description'])) {
        throw new RuntimeException((string)$decoded['error_description']);
    }

    if (isset($decoded['error'])) {
        throw new RuntimeException('Google sign-in validation failed.');
    }

    return $decoded;
}

function verify_google_id_token(string $idToken): array
{
    $config = app_config();
    $googleClientId = trim((string)($config['google_client_id'] ?? ''));
    if ($googleClientId === '') {
        throw new RuntimeException('Google sign-in is not configured yet.');
    }

    if ($idToken === '') {
        throw new RuntimeException('Missing Google credential.');
    }

    $payload = fetch_remote_json('https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($idToken));
    $issuer = (string)($payload['iss'] ?? '');
    $audience = (string)($payload['aud'] ?? '');
    $email = normalize_email((string)($payload['email'] ?? ''));
    $emailVerified = $payload['email_verified'] ?? false;
    $emailVerifiedValue = is_bool($emailVerified) ? $emailVerified : $emailVerified === 'true';

    if ($audience !== $googleClientId) {
        throw new RuntimeException('Google token audience does not match this TDMS app.');
    }

    if (!in_array($issuer, ['accounts.google.com', 'https://accounts.google.com'], true)) {
        throw new RuntimeException('Google token issuer is not valid.');
    }

    if ($email === null || !$emailVerifiedValue) {
        throw new RuntimeException('Your Google account must have a verified email address.');
    }

    if ((int)($payload['exp'] ?? 0) < time()) {
        throw new RuntimeException('Google sign-in token has expired. Please try again.');
    }

    return [
        'sub' => (string)($payload['sub'] ?? ''),
        'email' => $email,
        'name' => trim((string)($payload['name'] ?? $payload['given_name'] ?? 'Google Student')),
        'picture' => trim((string)($payload['picture'] ?? '')),
    ];
}

$pdo = tdms_db();
ensure_admin_security_schema($pdo);
upgrade_legacy_admin_passwords($pdo);
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$input = json_input();

try {
    if ($action === 'public-config' && $method === 'GET') {
        respond(['ok' => true, 'config' => public_client_config()]);
    }

    if ($action === 'session' && $method === 'GET') {
        respond(['ok' => true, 'session' => current_session()]);
    }

    if ($action === 'login' && $method === 'POST') {
        $role = trim((string)($input['role'] ?? ''));
        $identifier = trim((string)($input['identifier'] ?? ''));
        $secret = trim((string)($input['secret'] ?? ''));

        if ($role === 'staff') {
            if ($identifier === '' || $secret === '') {
                respond(['ok' => false, 'message' => 'Username and password are required.'], 422);
            }

            $admin = find_admin_for_login($pdo, $identifier);
            if (!$admin) {
                respond(['ok' => false, 'message' => 'Invalid staff login.'], 422);
            }

            if (admin_is_locked($admin)) {
                $lockUntil = strtotime((string)$admin['lock_until']);
                $formatted = $lockUntil ? date('M j, Y g:i A', $lockUntil) : 'later';
                respond(['ok' => false, 'message' => "Too many failed login attempts. Try again after {$formatted}."], 423);
            }

            if (!is_password_hash_string((string)$admin['password_hash']) || !password_verify($secret, (string)$admin['password_hash'])) {
                register_admin_login_failure($pdo, $admin);
                respond(['ok' => false, 'message' => 'Invalid staff login.'], 422);
            }

            reset_admin_login_attempts($pdo, (int)$admin['id']);
            $admin = fetch_admin_record($pdo, (int)$admin['id']) ?? $admin;
            $session = login_admin_session($admin);
            respond(['ok' => true, 'session' => $session]);
        }

        if ($role === 'student') {
            $student = find_student_for_login($pdo, $identifier);
            if (!$student) {
                respond(['ok' => false, 'message' => 'Student login not found.'], 422);
            }

            if (student_has_column($pdo, 'password_hash') && !empty($student['password_hash'])) {
                if (!password_verify($secret, (string)$student['password_hash'])) {
                    respond(['ok' => false, 'message' => 'Invalid student password.'], 422);
                }
            } elseif (mb_strtolower((string)$student['full_name']) !== mb_strtolower($secret)) {
                respond(['ok' => false, 'message' => 'Student login not found.'], 422);
            }

            $session = login_student_session($student);
            respond(['ok' => true, 'session' => $session]);
        }

        respond(['ok' => false, 'message' => 'Unsupported role.'], 422);
    }

    if ($action === 'register-student' && $method === 'POST') {
        $studentIdentifier = trim((string)($input['studentId'] ?? ''));
        $fullName = trim((string)($input['fullName'] ?? ''));
        $program = trim((string)($input['program'] ?? ''));
        $email = require_valid_email(normalize_email((string)($input['email'] ?? '')));
        $password = (string)($input['password'] ?? '');
        $passwordConfirm = (string)($input['passwordConfirm'] ?? '');
        $contact = trim((string)($input['contact'] ?? ''));

        if ($studentIdentifier === '' || $fullName === '' || $program === '') {
            respond(['ok' => false, 'message' => 'Student ID, full name, and program are required.'], 422);
        }

        if (!preg_match('/^\d{4}-\d{3}-\d{5}$/', $studentIdentifier)) {
            respond(['ok' => false, 'message' => 'Student ID must use the format 0000-000-00000.'], 422);
        }

        if ($password === '' || $passwordConfirm === '') {
            respond(['ok' => false, 'message' => 'Password and confirm password are required.'], 422);
        }

        if ($password !== $passwordConfirm) {
            respond(['ok' => false, 'message' => 'Passwords do not match.'], 422);
        }

        if (mb_strlen($password) < 6) {
            respond(['ok' => false, 'message' => 'Student password must be at least 6 characters long.'], 422);
        }

        if (!student_has_column($pdo, 'password_hash')) {
            respond(['ok' => false, 'message' => 'Student password storage is not ready yet. Add the password_hash column in MySQL first.'], 500);
        }

        if (student_has_column($pdo, 'email') && $email !== null) {
            $existingStmt = $pdo->prepare('SELECT id FROM students WHERE student_id = :student_id OR email = :email LIMIT 1');
            $existingStmt->execute([
                'student_id' => $studentIdentifier,
                'email' => $email,
            ]);
        } else {
            $existingStmt = $pdo->prepare('SELECT id FROM students WHERE student_id = :student_id LIMIT 1');
            $existingStmt->execute([
                'student_id' => $studentIdentifier,
            ]);
        }

        if ($existingStmt->fetch()) {
            respond(['ok' => false, 'message' => 'A student with that ID or email already exists.'], 422);
        }

        $passwordHash = password_hash($password, PASSWORD_DEFAULT);

        if (student_has_column($pdo, 'email') && student_has_column($pdo, 'auth_provider')) {
            $stmt = $pdo->prepare('INSERT INTO students (student_id, full_name, program, email, contact, password_hash, auth_provider) VALUES (:student_id, :full_name, :program, :email, :contact, :password_hash, :auth_provider)');
            $stmt->execute([
                'student_id' => $studentIdentifier,
                'full_name' => $fullName,
                'program' => $program,
                'email' => $email,
                'contact' => $contact,
                'password_hash' => $passwordHash,
                'auth_provider' => 'local',
            ]);
        } else {
            $stmt = $pdo->prepare('INSERT INTO students (student_id, full_name, program, contact, password_hash) VALUES (:student_id, :full_name, :program, :contact, :password_hash)');
            $stmt->execute([
                'student_id' => $studentIdentifier,
                'full_name' => $fullName,
                'program' => $program,
                'contact' => $contact !== '' ? $contact : (string)($email ?? ''),
                'password_hash' => $passwordHash,
            ]);
        }

        $student = fetch_student_record($pdo, (int)$pdo->lastInsertId());
        if (!$student) {
            throw new RuntimeException('Student registration completed, but the account could not be loaded.');
        }

        $session = login_student_session($student);
        respond(['ok' => true, 'session' => $session, 'student' => $student]);
    }

    if ($action === 'login-google' && $method === 'POST') {
        if (!student_has_column($pdo, 'email') || !student_has_column($pdo, 'auth_provider') || !student_has_column($pdo, 'google_sub')) {
            respond(['ok' => false, 'message' => 'Google login needs the student email columns added in MySQL first.'], 422);
        }

        $googleUser = verify_google_id_token(trim((string)($input['idToken'] ?? '')));
        if ($googleUser['sub'] === '') {
            respond(['ok' => false, 'message' => 'Google sign-in did not return a valid account ID.'], 422);
        }

        $student = find_student_for_google($pdo, $googleUser['email'], $googleUser['sub']);
        $isNewStudent = false;

        if ($student) {
            $updateStmt = $pdo->prepare('UPDATE students SET full_name = :full_name, email = :email, google_sub = :google_sub, auth_provider = :auth_provider, contact = CASE WHEN contact = "" THEN :contact ELSE contact END WHERE id = :id');
            $updateStmt->execute([
                'full_name' => $googleUser['name'],
                'email' => $googleUser['email'],
                'google_sub' => $googleUser['sub'],
                'auth_provider' => 'google',
                'contact' => isset($student['contact']) && $student['contact'] !== '' ? $student['contact'] : $googleUser['email'],
                'id' => $student['id'],
            ]);
            $student = fetch_student_record($pdo, (int)$student['id']);
        } else {
            $isNewStudent = true;
            $generatedCode = generate_student_identifier($pdo);
            $insertStmt = $pdo->prepare('INSERT INTO students (student_id, full_name, program, email, contact, auth_provider, google_sub) VALUES (:student_id, :full_name, :program, :email, :contact, :auth_provider, :google_sub)');
            $insertStmt->execute([
                'student_id' => $generatedCode,
                'full_name' => $googleUser['name'],
                'program' => 'Pending Program Assignment',
                'email' => $googleUser['email'],
                'contact' => $googleUser['email'],
                'auth_provider' => 'google',
                'google_sub' => $googleUser['sub'],
            ]);
            $student = fetch_student_record($pdo, (int)$pdo->lastInsertId());
        }

        if (!$student) {
            throw new RuntimeException('Unable to load the Google student account.');
        }

        $session = login_student_session($student);
        respond([
            'ok' => true,
            'session' => $session,
            'student' => $student,
            'isNewStudent' => $isNewStudent,
        ]);
    }

    if ($action === 'logout' && ($method === 'POST' || $method === 'GET')) {
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'] ?? '/',
                $params['domain'] ?? '',
                (bool)($params['secure'] ?? false),
                (bool)($params['httponly'] ?? true)
            );
        }

        session_destroy();
        respond(['ok' => true, 'session' => ['isLoggedIn' => false, 'role' => '', 'userName' => '', 'studentId' => '']]);
    }

    if ($action === 'change-staff-password' && $method === 'POST') {
        $session = require_login('staff');
        $adminId = (int)($session['adminId'] ?? 0);
        if ($adminId <= 0) {
            respond(['ok' => false, 'message' => 'Staff account session is missing. Please log in again.'], 401);
        }

        $admin = fetch_admin_record($pdo, $adminId);
        if (!$admin) {
            respond(['ok' => false, 'message' => 'Staff account could not be found.'], 404);
        }

        $username = trim((string)($input['username'] ?? ''));
        $fullName = trim((string)($input['fullName'] ?? ''));
        $currentPassword = (string)($input['currentPassword'] ?? '');
        $newPassword = (string)($input['newPassword'] ?? '');
        $confirmPassword = (string)($input['confirmPassword'] ?? '');
        $email = require_valid_staff_email($input['email'] ?? null);

        if ($username === '' || $fullName === '') {
            respond(['ok' => false, 'message' => 'Username and full name are required.'], 422);
        }

        if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username)) {
            respond(['ok' => false, 'message' => 'Username must be 3-50 characters and can use letters, numbers, dots, dashes, and underscores only.'], 422);
        }

        if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
            respond(['ok' => false, 'message' => 'Current password, new password, and confirm password are required.'], 422);
        }

        if (!password_verify($currentPassword, (string)$admin['password_hash'])) {
            respond(['ok' => false, 'message' => 'Current password is incorrect.'], 422);
        }

        if ($newPassword !== $confirmPassword) {
            respond(['ok' => false, 'message' => 'New password and confirm password do not match.'], 422);
        }

        if (mb_strlen($newPassword) < 10) {
            respond(['ok' => false, 'message' => 'New staff password must be at least 10 characters long.'], 422);
        }

        if (!preg_match('/[A-Za-z]/', $newPassword) || !preg_match('/\d/', $newPassword)) {
            respond(['ok' => false, 'message' => 'New staff password must include both letters and numbers.'], 422);
        }

        if (password_verify($newPassword, (string)$admin['password_hash'])) {
            respond(['ok' => false, 'message' => 'Choose a new password that is different from the current one.'], 422);
        }

        $existingUsernameStmt = $pdo->prepare('SELECT id FROM admins WHERE username = :username AND id <> :id LIMIT 1');
        $existingUsernameStmt->execute([
            'username' => $username,
            'id' => $adminId,
        ]);
        if ($existingUsernameStmt->fetch()) {
            respond(['ok' => false, 'message' => 'That username is already being used by another staff account.'], 422);
        }

        $stmt = $pdo->prepare('
            UPDATE admins
            SET username = :username,
                full_name = :full_name,
                password_hash = :password_hash,
                email = :email,
                must_change_password = 0,
                failed_login_attempts = 0,
                lock_until = NULL,
                password_changed_at = :password_changed_at
            WHERE id = :id
        ');
        $stmt->execute([
            'username' => $username,
            'full_name' => $fullName,
            'password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
            'email' => $email,
            'password_changed_at' => date('Y-m-d H:i:s'),
            'id' => $adminId,
        ]);

        $updatedAdmin = fetch_admin_record($pdo, $adminId);
        if (!$updatedAdmin) {
            throw new RuntimeException('Staff account was updated but could not be reloaded.');
        }

        $sessionPayload = login_admin_session($updatedAdmin);
        respond([
            'ok' => true,
            'message' => 'Staff password updated successfully.',
            'session' => $sessionPayload,
            'account' => fetch_admin_profile($pdo, $adminId),
        ]);
    }

    if ($action === 'admin-data' && $method === 'GET') {
        $session = require_login('staff');
        $adminId = (int)($session['adminId'] ?? 0);
        respond([
            'ok' => true,
            'session' => current_session(),
            'account' => $adminId > 0 ? fetch_admin_profile($pdo, $adminId) : null,
            'students' => fetch_students($pdo),
            'tasks' => fetch_tasks($pdo),
        ]);
    }

    if ($action === 'student-data' && $method === 'GET') {
        $session = require_login('student');
        $studentId = (int)$session['studentId'];

        respond([
            'ok' => true,
            'session' => current_session(),
            'student' => fetch_student_profile($pdo, $studentId),
            'subjects' => fetch_subjects($pdo, $studentId),
            'tasks' => fetch_tasks($pdo, $studentId),
        ]);
    }

    if ($action === 'add-admin-reminder' && $method === 'POST') {
        require_staff_password_updated();

        $stmt = $pdo->prepare('
            INSERT INTO tasks (student_id, subject_name, title, category, priority, due_date, notes, status, source)
            VALUES (:student_id, :subject_name, :title, :category, :priority, :due_date, :notes, "Pending", "admin")
        ');
        $stmt->execute([
            'student_id' => (int)$input['studentId'],
            'subject_name' => trim((string)($input['subject'] ?? '')),
            'title' => trim((string)($input['title'] ?? '')),
            'category' => trim((string)($input['category'] ?? 'Missing Requirement')),
            'priority' => trim((string)($input['priority'] ?? 'High')),
            'due_date' => trim((string)($input['dueDate'] ?? '')),
            'notes' => trim((string)($input['notes'] ?? '')),
        ]);

        respond(['ok' => true]);
    }

    if ($action === 'add-student-subject' && $method === 'POST') {
        $session = require_login('student');
        $stmt = $pdo->prepare('
            INSERT INTO subjects (student_id, year_level, semester, name)
            VALUES (:student_id, :year_level, :semester, :name)
        ');
        $stmt->execute([
            'student_id' => (int)$session['studentId'],
            'year_level' => trim((string)($input['year'] ?? '')),
            'semester' => trim((string)($input['semester'] ?? '')),
            'name' => trim((string)($input['name'] ?? '')),
        ]);

        respond(['ok' => true]);
    }

    if ($action === 'add-student-task' && $method === 'POST') {
        $session = require_login('student');
        $stmt = $pdo->prepare('
            INSERT INTO tasks (student_id, subject_name, title, category, priority, due_date, notes, status, source)
            VALUES (:student_id, :subject_name, :title, :category, :priority, :due_date, :notes, "Pending", "student")
        ');
        $stmt->execute([
            'student_id' => (int)$session['studentId'],
            'subject_name' => trim((string)($input['subject'] ?? '')),
            'title' => trim((string)($input['title'] ?? '')),
            'category' => trim((string)($input['category'] ?? 'Personal Task')),
            'priority' => trim((string)($input['priority'] ?? 'Medium')),
            'due_date' => trim((string)($input['dueDate'] ?? '')),
            'notes' => trim((string)($input['notes'] ?? '')),
        ]);

        respond(['ok' => true]);
    }

    if ($action === 'toggle-task' && $method === 'POST') {
        $session = require_login();
        $taskId = (int)($input['taskId'] ?? 0);

        if (($session['role'] ?? '') === 'staff') {
            require_staff_password_updated();
        }

        $taskStmt = $pdo->prepare('SELECT id, student_id, status FROM tasks WHERE id = :id LIMIT 1');
        $taskStmt->execute(['id' => $taskId]);
        $task = $taskStmt->fetch();

        if (!$task) {
            respond(['ok' => false, 'message' => 'Task not found.'], 404);
        }

        if ($session['role'] === 'student' && (int)$session['studentId'] !== (int)$task['student_id']) {
            respond(['ok' => false, 'message' => 'Access denied.'], 403);
        }

        $newStatus = $task['status'] === 'Completed' ? 'Pending' : 'Completed';
        $stmt = $pdo->prepare('
            UPDATE tasks
            SET status = :status, completed_at = :completed_at
            WHERE id = :id
        ');
        $stmt->execute([
            'status' => $newStatus,
            'completed_at' => $newStatus === 'Completed' ? date('Y-m-d H:i:s') : null,
            'id' => $taskId,
        ]);

        respond(['ok' => true]);
    }

    if ($action === 'seed-demo' && $method === 'POST') {
        require_staff_password_updated();

        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM tasks');
        $pdo->exec('DELETE FROM subjects');
        $pdo->exec('DELETE FROM students');

        if (student_has_column($pdo, 'email') && student_has_column($pdo, 'auth_provider')) {
            $studentStmt = $pdo->prepare('INSERT INTO students (student_id, full_name, program, email, contact, auth_provider) VALUES (:student_id, :full_name, :program, :email, :contact, :auth_provider)');
        } else {
            $studentStmt = $pdo->prepare('INSERT INTO students (student_id, full_name, program, contact) VALUES (:student_id, :full_name, :program, :contact)');
        }

        $subjectStmt = $pdo->prepare('INSERT INTO subjects (student_id, year_level, semester, name) VALUES (:student_id, :year_level, :semester, :name)');
        $taskStmt = $pdo->prepare('
            INSERT INTO tasks (student_id, subject_name, title, category, priority, due_date, notes, status, source)
            VALUES (:student_id, :subject_name, :title, :category, :priority, :due_date, :notes, :status, :source)
        ');

        $students = [
            ['2026-001-00001', 'Maria Santos', 'Diploma in Information Technology', 'maria.santos@gmail.com', '09171234567'],
            ['2026-014-00002', 'John Cruz', 'Diploma in Business Administration', 'john.cruz@gmail.com', '09181234567'],
            ['2026-021-00003', 'Aira Reyes', 'Diploma in Hospitality Management', 'aira.reyes@gmail.com', '09191234567'],
        ];

        $studentIds = [];
        foreach ($students as $row) {
            $params = [
                'student_id' => $row[0],
                'full_name' => $row[1],
                'program' => $row[2],
                'contact' => $row[4],
            ];
            if (student_has_column($pdo, 'email') && student_has_column($pdo, 'auth_provider')) {
                $params['email'] = $row[3];
                $params['auth_provider'] = 'local';
            }

            $studentStmt->execute($params);
            $studentIds[$row[0]] = (int)$pdo->lastInsertId();
        }

        $subjects = [
            ['2026-001-00001', '1st Year', '1st Semester', 'Systems Analysis and Design'],
            ['2026-001-00001', '1st Year', '1st Semester', 'Database Management'],
            ['2026-014-00002', '1st Year', '1st Semester', 'Business Communication'],
            ['2026-021-00003', '1st Year', '1st Semester', 'Hospitality Operations'],
        ];

        foreach ($subjects as $row) {
            $subjectStmt->execute([
                'student_id' => $studentIds[$row[0]],
                'year_level' => $row[1],
                'semester' => $row[2],
                'name' => $row[3],
            ]);
        }

        $today = new DateTimeImmutable('today');
        $tasks = [
            ['2026-001-00001', 'Systems Analysis and Design', 'Submit practicum journal', 'Document', 'High', $today->modify('+1 day')->format('Y-m-d'), 'Send to TVET office before 5:00 PM.', 'Pending', 'admin'],
            ['2026-014-00002', 'Business Communication', 'Complete portfolio checking', 'Assessment', 'Medium', $today->modify('+3 day')->format('Y-m-d'), 'Bring printed copy for verification.', 'Pending', 'admin'],
            ['2026-021-00003', 'Hospitality Operations', 'Finalize on-the-job training form', 'Project', 'High', $today->modify('-1 day')->format('Y-m-d'), 'Follow up by phone if not yet submitted.', 'Pending', 'admin'],
        ];

        foreach ($tasks as $row) {
            $taskStmt->execute([
                'student_id' => $studentIds[$row[0]],
                'subject_name' => $row[1],
                'title' => $row[2],
                'category' => $row[3],
                'priority' => $row[4],
                'due_date' => $row[5],
                'notes' => $row[6],
                'status' => $row[7],
                'source' => $row[8],
            ]);
        }

        $pdo->commit();
        respond(['ok' => true]);
    }

    if ($action === 'clear-data' && $method === 'POST') {
        require_staff_password_updated();
        $pdo->exec('DELETE FROM tasks');
        $pdo->exec('DELETE FROM subjects');
        $pdo->exec('DELETE FROM students');
        respond(['ok' => true]);
    }

    respond(['ok' => false, 'message' => 'Route not found.'], 404);
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(['ok' => false, 'message' => $error->getMessage()], 500);
}

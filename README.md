# Task and Deadline Management System (TDMS)

This is a TDMS for TVET staff and diploma students. The current version is built with a browser frontend plus a PHP/MySQL backend.

## Features

- Add and search students
- Create tasks with due dates and notes
- Track pending, completed, and overdue work
- See reminder cards for deadlines due within 3 days
- Print a basic report from the dashboard
- Save data in the browser using local storage

## Pages

- `index.html` - login page
- `admin.html` - admin reminder dashboard
- `student.html` - student task dashboard

## Backend Files

- `api/index.php` - PHP API router
- `api/db.php` - MySQL connection helper
- `api/config.example.php` - sample database config
- `database.sql` - database schema and default admin record

## MySQL Setup

1. Create a MySQL database by importing `database.sql`.
2. Copy `api/config.example.php` to `api/config.php`.
3. Update `api/config.php` with your MySQL host, port, database name, username, and password.
4. Place the project inside your PHP web server root.
   Example for XAMPP: `htdocs/tdms`
5. Open the project through Apache, not by double-clicking the HTML file.
   Example: `http://localhost/tdms/index.html`

## How to run

1. Start Apache and MySQL.
2. Open `index.html` through your local web server URL.
3. Sign in as staff or student.
4. Use `Load sample data` from the admin page if you want demo student records, subjects, and reminders immediately.

## Notes

- This version now requires PHP and MySQL to be running.
- The frontend calls `api/index.php`, so the project must be opened from a web server such as Apache.
- Staff demo login: `admin` / `admin123`
- Student login uses the student ID and full student name saved in MySQL.

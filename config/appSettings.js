const appSettings = {
  appName: "Exam Management System",
  instituteName: "ADYPU SOE",
  logoUrl: "",
  contactEmail: "admin@adypu.edu.in",
  contactPhone: "",
  address: "",
  termsAndConditions: `TERMS AND CONDITIONS

Last Updated: ${new Date().toLocaleDateString()}

1. INTRODUCTION
Welcome to the Exam Management System. By accessing and using this system, you agree to be bound by these terms and conditions.

2. USER ACCOUNTS
- Each user is responsible for maintaining the confidentiality of their account credentials.
- Users must provide accurate and complete information during registration.
- The system administrators reserve the right to suspend or terminate accounts that violate these terms.

3. USAGE GUIDELINES
- This system is intended for academic examination management purposes only.
- Users must not attempt to access unauthorized data or systems.
- Any attempt to manipulate exam seating arrangements is strictly prohibited.

4. DATA PRIVACY
- The system collects and processes personal information as necessary for exam management.
- User data will be handled in accordance with applicable privacy regulations.
- Users have the right to access and correct their personal data.

5. ACADEMIC INTEGRITY
- Any form of cheating during examinations will be reported to appropriate authorities.
- Students must follow all examination rules and regulations.
- Invigilators must report any suspicious behavior immediately.

6. LIABILITY
- The institution shall not be liable for any loss or damage arising from the use of this system.
- Users use this system at their own risk.

7. MODIFICATIONS
- The administration reserves the right to modify these terms and conditions at any time.
- Continued use of the system after modifications constitutes acceptance of the new terms.

8. CONTACT
For questions about these terms, please contact the system administrator.`,
  allowStudentLogin: true,
  allowTeacherLogin: true,
  examDurationBuffer: 15,
  defaultPassword: "pass123",
  seatingStrategy: "reinforcement-guided"
};

function getAppSettings() {
  return appSettings;
}

function updateAppSettings(patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      appSettings[key] = value;
    }
  }
  return appSettings;
}

module.exports = {
  getAppSettings,
  updateAppSettings
};

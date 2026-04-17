const User = require("../models/user");
const bcrypt = require("bcryptjs");

// In-memory settings storage (in production, use database)
let appSettings = {
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
  examDurationBuffer: 15, // minutes
  defaultPassword: "pass123"
};

// Get current user profile
async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Update current user profile
async function updateProfile(req, res) {
  try {
    const { fullName, rollNumber, className } = req.body;
    const updateFields = {};

    if (fullName !== undefined) updateFields.fullName = fullName;
    if (rollNumber !== undefined) updateFields.rollNumber = rollNumber;
    if (className !== undefined) updateFields.className = className;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true }
    ).select("-password");

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Change password
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }

    const user = await User.findById(req.user._id);
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ ok: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get app settings (public endpoint)
async function getSettings(req, res) {
  try {
    // Return settings without sensitive data
    const publicSettings = {
      appName: appSettings.appName,
      instituteName: appSettings.instituteName,
      logoUrl: appSettings.logoUrl,
      contactEmail: appSettings.contactEmail,
      contactPhone: appSettings.contactPhone,
      address: appSettings.address,
      allowStudentLogin: appSettings.allowStudentLogin,
      allowTeacherLogin: appSettings.allowTeacherLogin,
      examDurationBuffer: appSettings.examDurationBuffer,
      defaultPassword: appSettings.defaultPassword
    };
    res.json(publicSettings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Update app settings (admin only)
async function updateSettings(req, res) {
  try {
    const {
      appName,
      instituteName,
      logoUrl,
      contactEmail,
      contactPhone,
      address,
      termsAndConditions,
      allowStudentLogin,
      allowTeacherLogin,
      examDurationBuffer,
      defaultPassword
    } = req.body;

    if (appName !== undefined) appSettings.appName = appName;
    if (instituteName !== undefined) appSettings.instituteName = instituteName;
    if (logoUrl !== undefined) appSettings.logoUrl = logoUrl;
    if (contactEmail !== undefined) appSettings.contactEmail = contactEmail;
    if (contactPhone !== undefined) appSettings.contactPhone = contactPhone;
    if (address !== undefined) appSettings.address = address;
    if (termsAndConditions !== undefined) appSettings.termsAndConditions = termsAndConditions;
    if (allowStudentLogin !== undefined) appSettings.allowStudentLogin = allowStudentLogin;
    if (allowTeacherLogin !== undefined) appSettings.allowTeacherLogin = allowTeacherLogin;
    if (examDurationBuffer !== undefined) appSettings.examDurationBuffer = examDurationBuffer;
    if (defaultPassword !== undefined) appSettings.defaultPassword = defaultPassword;

    res.json({ ok: true, settings: appSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Get terms and conditions (public endpoint)
async function getTerms(req, res) {
  try {
    res.json({ terms: appSettings.termsAndConditions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getSettings,
  updateSettings,
  getTerms
};